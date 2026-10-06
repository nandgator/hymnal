import { test as base } from "@playwright/test";
import { answerPersist } from "./helpers.ts";

export { expect } from "@playwright/test";

export const test = base.extend({
  context: async ({ context }, use) => {
    await answerPersist(context);
    await use(context);
  },
});
