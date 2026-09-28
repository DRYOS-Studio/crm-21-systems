import assert from "node:assert/strict";
import test from "node:test";
import { transferConversationErrorMessage } from "../../src/lib/transfer-conversation-errors.ts";

test("transferConversationErrorMessage maps duplicate_contact", () => {
  assert.equal(
    transferConversationErrorMessage("duplicate_contact"),
    "Quem você escolheu já tem este contato no inbox.",
  );
});
