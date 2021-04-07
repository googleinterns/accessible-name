/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Rule} from './compute_text_alternative';

/**
 * This interface will be used to pass additional information
 * about the element whose name is being computed.
 */
export interface Context {
  /**
   * directLabelReference indicates whether the current node
   * is being visited as a result of being referenced:
   * (i) by an aria-labelledby
   * (ii) as a native label
   * by the previously visited node.
   */
  // #SPEC_ASSUMPTION (CON.1) : aria-labelledby and native label
  // references considered equivalent.
  directLabelReference?: boolean;
  /**
   * 'inherited' object stores any context properties
   * that are to be passed on to a new 'current node'
   * from the previous 'current node'.
   */
  inherited: {
    /**
     * partOfName inidicates whether the current node is
     * part of the accessible name for another node.
     * This is true iff the node has been passed recursively
     * to the algorithm.
     */
    // #SPEC_ASSUMPTION (CON.2) : several node context markers
    // may be considered equivalent.
    partOfName?: boolean;
    /**
     * visitedNodes stores any nodes visited recursively by rule 2F
     * to ensure that any node is visited at most once. This
     * prevents infinite cycles during node traversal.
     */
    visitedNodes: Node[];

    // TODO: Look into merging 'nodesUsed' and 'visitedNodes'

    /**
     * nodesUsed stores any Nodes used during the name computation
     * algorithm, including the original target node.
     */
    nodesUsed: Set<Node>;
    /**
     * rulesApplied stores all Rules that were applied during the
     * name computation algorithm.
     */
    rulesApplied: Set<Rule>;

    /**
     * Ignore whether a node is hidden or not - compute accessible name as if
     * all nodes are displayed
     */
    ignoreHiddenness: boolean;
  };
}

/**
 * Returns a context instance in its default state.
 */
export function getDefaultContext(): Context {
  return {
    inherited: {
      visitedNodes: [],
      nodesUsed: new Set<Node>(),
      rulesApplied: new Set<Rule>(),
      ignoreHiddenness: false,
    },
  };
}
