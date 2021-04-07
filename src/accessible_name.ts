/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {ComputationDetails, computeTextAlternative} from './lib/compute_text_alternative';
import {getDefaultContext} from './lib/context';

/**
 * Compute the accessible name for a given HTMLElement.
 * @param elem - The HTMLElement whose accessible name will be calculated.
 * @param ignoreHiddenness - Return a non-empty accessible name for hidden
 *     elements (what the accessible name would be if no elements were hidden)
 */
export function getAccessibleName(
    elem: HTMLElement, ignoreHiddenness: boolean = false): string {
  const context = getDefaultContext();
  context.inherited.ignoreHiddenness = ignoreHiddenness;
  return computeTextAlternative(elem, context).name;
}

/**
 * Get details surrounding the computation of the accessible name for a given
 * HTMLElement
 * @param elem - The HTMLElement whose accessible name will be calculated.
 * @param ignoreHiddenness - Return a non-empty accessible name for hidden
 *     elements (what the accessible name would be if no elements were hidden)
 */
export function getNameComputationDetails(
    elem: HTMLElement, ignoreHiddenness: boolean = false): ComputationDetails {
  const context = getDefaultContext();
  context.inherited.ignoreHiddenness = ignoreHiddenness;
  return computeTextAlternative(elem, context);
}
