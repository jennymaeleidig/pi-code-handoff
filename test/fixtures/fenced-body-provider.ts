/**
 * A scripted provider for the picker's real-binary test.
 *
 * The single hand-off block is a full file whose body contains a fenced block
 * of its own, so `renderBlock` must choose a longer fence and the hand-off tab
 * must still copy the body byte for byte.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  createAssistantMessageEventStream,
  type TranscriptContext,
  type ToolCall,
} from "@earendil-works/pi-ai";

export const NOTES = ["# Notes", "", "```sh", "echo hi", "```", "", "Done.", ""].join("\n");

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function respond(
  model: Model<string>,
  text: string,
  toolCall?: { id: string; name: string; arguments: ToolCall["arguments"] },
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: USAGE,
    stopReason: "pending",
    timestamp: Date.now(),
  };
  stream.push({ type: "start", partial: message });

  if (text !== "") {
    message.content.push({ type: "text", text });
    stream.push({ type: "text_start", contentIndex: 0, partial: message });
    stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
    stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
  }

  if (toolCall) {
    const index = message.content.length;
    message.content.push({ type: "toolCall", ...toolCall });
    stream.push({ type: "toolcall_start", contentIndex: index, partial: message });
    stream.push({
      type: "toolcall_delta",
      contentIndex: index,
      delta: JSON.stringify(toolCall.arguments),
      partial: message,
    });
    stream.push({
      type: "toolcall_end",
      contentIndex: index,
      toolCall: { type: "toolCall", ...toolCall },
      partial: message,
    });
    message.stopReason = "toolUse";
    stream.push({ type: "done", reason: "toolUse", message });
  } else {
    message.stopReason = "stop";
    stream.push({ type: "done", reason: "stop", message });
  }
  stream.end(message);
  return stream;
}

export default function fencedBodyProvider(pi: ExtensionAPI): void {
  pi.registerProvider("fenced-body", {
    name: "Fenced body",
    baseUrl: "http://fenced-body.invalid",
    apiKey: "fenced-body",
    api: "openai-completions",
    models: [
      {
        id: "fenced-body",
        name: "Fenced body",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100000,
        maxTokens: 4096,
      },
    ],
    streamSimple(model: Model<string>, context: TranscriptContext) {
      const results = context.messages.filter(
        (message) => message.role === "toolResult" && message.toolName === "code_handoff",
      ).length;

      if (results === 0) {
        return respond(model, "", {
          id: "call-notes",
          name: "code_handoff",
          arguments: {
            kind: "code",
            path: "notes.md",
            form: "full",
            content: NOTES,
          },
        });
      }
      return respond(model, "Notes are ready.");
    },
  });
}
