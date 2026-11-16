import changelog from "../../CHANGELOG.md?raw";
import { parseChangelog } from "./changelog";

/** CHANGELOG.md as bundled into this build at compile time. */
export const RELEASES = parseChangelog(changelog);
