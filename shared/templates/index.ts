import type { BoxTemplate } from "../template-types";
import mailer from "./mailer-box.json";
import magnetic from "./magnetic-closure-box.json";
import rte from "./reverse-tuck-end.json";
import twoPiece from "./two-piece-box.json";
import burger from "./burger-box.json";
import fry from "./french-fry-box.json";
import pillow from "./pillow-box.json";

/**
 * Bundled box styles. To add a style permanently, drop a JSON file in this
 * folder and list it here — or add it at runtime from the admin panel
 * (Admin → Box Templates), which needs no rebuild at all.
 */
export const BUILTIN_TEMPLATES: BoxTemplate[] = [mailer, magnetic, rte, twoPiece, burger, fry, pillow] as BoxTemplate[];
