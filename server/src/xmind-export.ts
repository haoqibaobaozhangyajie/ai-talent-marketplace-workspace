import fs from "node:fs/promises";
import path from "node:path";
import { Topic, Workbook, Zipper } from "xmind";
import type { ExportStatus, KnowledgeGraph } from "../../shared/contracts.js";

function flatten(graph: KnowledgeGraph, nodeId: string): string[] {
  const result = [nodeId];
  for (const childId of graph.nodes[nodeId].children) {
    result.push(...flatten(graph, childId));
  }
  return result;
}

export async function exportGraphToXmind(
  graph: KnowledgeGraph,
  filePath: string
): Promise<ExportStatus> {
  const workbook = new Workbook();
  const rootNode = graph.nodes[graph.rootId];
  const sheet = workbook.createSheet(rootNode.title, rootNode.title);
  const topic = new Topic({ sheet });
  const rootTargetId = topic.cid();
  if (!rootTargetId) {
    throw new Error("Unable to resolve XMind root topic id.");
  }
  const sourceToTargetId = new Map<string, string>([[graph.rootId, rootTargetId]]);

  const queue = [graph.rootId];
  while (queue.length) {
    const sourceId = queue.shift()!;
    const targetParentId = sourceToTargetId.get(sourceId)!;
    const sourceNode = graph.nodes[sourceId];

    for (const childSourceId of sourceNode.children) {
      const child = graph.nodes[childSourceId];
      topic.on(targetParentId).add({ title: child.title, parentId: targetParentId });
      const childTargetId = topic.cid(child.title, { parentId: targetParentId });
      if (!childTargetId) {
        throw new Error(`Unable to resolve XMind child topic id for ${child.title}.`);
      }
      sourceToTargetId.set(childSourceId, childTargetId);
      if (child.summary) {
        topic.on(childTargetId).note(child.summary);
      }
      queue.push(childSourceId);
    }
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const zipper = new Zipper({
    path: path.dirname(filePath),
    workbook,
    filename: path.basename(filePath, ".xmind")
  });
  const saved = await zipper.save();
  if (!saved) {
    throw new Error("Failed to save XMind file.");
  }

  return {
    path: filePath,
    filename: path.basename(filePath),
    nodeCount: flatten(graph, graph.rootId).length - 1,
    exportedAt: new Date().toISOString()
  };
}
