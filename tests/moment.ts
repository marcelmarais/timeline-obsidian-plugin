import { createRequire } from "node:module";
import type { Moment } from "../src/dates";

/**
 * The Moment that Obsidian ships with, from the `obsidian` package's own dependency, so the tests format dates
 * exactly as the app will without the plugin depending on Moment itself.
 */
const require = createRequire(import.meta.url);
const obsidianPackage = require.resolve("obsidian/package.json");
export const moment = createRequire(obsidianPackage)("moment") as Moment;
