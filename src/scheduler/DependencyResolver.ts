/**
 * DependencyResolver — DAG-based job dependency resolution.
 *
 * Solves the problem: "Job B should only run after Job A completes successfully."
 *
 * Algorithm:
 *  1. Build a directed graph where edges represent "A must complete before B"
 *  2. Detect cycles (DAG validation) using DFS
 *  3. Topological sort to determine safe execution order
 *  4. As jobs complete, emit events to unblock waiting dependents
 *
 * Persistence: resolved_dependency_count in PostgreSQL is the source of truth.
 * This in-memory graph is rebuilt on scheduler startup and kept in sync
 * via events.
 */

import EventEmitter from 'eventemitter3';
import { createLogger } from '../utils/logger';
import { Job, JobDependency, JobStatus } from '../models/Job';

const log = createLogger('DependencyResolver');

export interface DepNode {
  jobId: string;
  dependencies: JobDependency[];
  dependents: string[];   // jobs that depend on this one
  isResolved: boolean;
}

export class DependencyResolver extends EventEmitter {
  private graph = new Map<string, DepNode>();

  /**
   * Register a job and its dependencies in the in-memory graph.
   */
  register(job: Job): void {
    if (!this.graph.has(job.id)) {
      this.graph.set(job.id, {
        jobId: job.id,
        dependencies: job.dependencies,
        dependents: [],
        isResolved: job.dependencies.length === 0,
      });
    }

    // Wire up reverse edges: for each dep, add this job as a dependent
    for (const dep of job.dependencies) {
      if (!this.graph.has(dep.jobId)) {
        this.graph.set(dep.jobId, {
          jobId: dep.jobId,
          dependencies: [],
          dependents: [],
          isResolved: true,
        });
      }
      const depNode = this.graph.get(dep.jobId)!;
      if (!depNode.dependents.includes(job.id)) {
        depNode.dependents.push(job.id);
      }
    }
  }

  /**
   * Called when a job transitions to a terminal state.
   * Returns the IDs of jobs that are now unblocked.
   */
  onJobStateChange(jobId: string, newStatus: JobStatus): string[] {
    const node = this.graph.get(jobId);
    if (!node) return [];

    const unblocked: string[] = [];

    for (const dependentId of node.dependents) {
      const depNode = this.graph.get(dependentId);
      if (!depNode || depNode.isResolved) continue;

      const jobDep = depNode.dependencies.find((d) => d.jobId === jobId);
      if (!jobDep) continue;

      // Check if the status satisfies the dependency requirement
      if (jobDep.requireStatus.includes(newStatus)) {
        const allMet = this.checkAllDependenciesMet(depNode);
        if (allMet) {
          depNode.isResolved = true;
          unblocked.push(dependentId);
          log.debug('Job dependencies resolved', { jobId: dependentId });
        }
      }
    }

    if (unblocked.length > 0) {
      this.emit('jobs:unblocked', unblocked);
    }

    return unblocked;
  }

  /**
   * Check if all dependencies for a given node are satisfied.
   * This is conservative: requires ALL deps to be met.
   */
  private checkAllDependenciesMet(node: DepNode): boolean {
    for (const dep of node.dependencies) {
      const depNode = this.graph.get(dep.jobId);
      if (!depNode?.isResolved) return false;
    }
    return true;
  }

  /**
   * Detect cycles in the dependency graph using DFS.
   * Throws if a cycle is found (prevents deadlock).
   */
  validateNoCycles(jobIds: string[]): void {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (id: string, path: string[]): void => {
      if (inStack.has(id)) {
        const cycleStart = path.indexOf(id);
        const cycle = [...path.slice(cycleStart), id].join(' → ');
        throw new Error(`Circular dependency detected: ${cycle}`);
      }
      if (visited.has(id)) return;

      visited.add(id);
      inStack.add(id);

      const node = this.graph.get(id);
      if (node) {
        for (const dep of node.dependencies) {
          dfs(dep.jobId, [...path, id]);
        }
      }

      inStack.delete(id);
    };

    for (const id of jobIds) {
      if (!visited.has(id)) dfs(id, []);
    }
  }

  /**
   * Topological sort — returns jobs in safe execution order.
   */
  topologicalSort(jobIds: string[]): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);
      const node = this.graph.get(id);
      if (node) {
        for (const dep of node.dependencies) {
          visit(dep.jobId);
        }
      }
      sorted.push(id);
    };

    for (const id of jobIds) visit(id);
    return sorted;
  }

  isResolved(jobId: string): boolean {
    return this.graph.get(jobId)?.isResolved ?? true;
  }

  deregister(jobId: string): void {
    const node = this.graph.get(jobId);
    if (node) {
      // Clean up reverse edges
      for (const dep of node.dependencies) {
        const depNode = this.graph.get(dep.jobId);
        if (depNode) {
          depNode.dependents = depNode.dependents.filter((d) => d !== jobId);
        }
      }
      this.graph.delete(jobId);
    }
  }

  getStats(): { totalNodes: number; resolvedNodes: number; pendingNodes: number } {
    let resolved = 0;
    for (const node of this.graph.values()) {
      if (node.isResolved) resolved++;
    }
    return {
      totalNodes: this.graph.size,
      resolvedNodes: resolved,
      pendingNodes: this.graph.size - resolved,
    };
  }
}

export const dependencyResolver = new DependencyResolver();
