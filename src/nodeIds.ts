import { asNodeId, type NodeId } from '@weasel-js/core';

let nextNodeId = 1;
export function genNodeId(): NodeId {
  return asNodeId(`node-${nextNodeId++}`);
}

/** After restoring a persisted scene, advance the id counter past every
 *  restored `node-N` id so new nodes can't collide with them. */
export function bumpNodeIdCounter(ids: Iterable<string>): void {
  for (const id of ids) {
    const m = /^node-(\d+)$/.exec(id);
    if (m) nextNodeId = Math.max(nextNodeId, Number(m[1]) + 1);
  }
}
