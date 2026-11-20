import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { FromSchema } from "json-schema-to-ts";
import { schemas } from "./schema";

export type Answer = FromSchema<typeof schemas.answer>;
export type Walkthrough = FromSchema<typeof schemas.walkthrough>;
export type ReadyWorkflow = Extract<Walkthrough, { outcome: "ready" }>;
export type Playback = FromSchema<typeof schemas.playback>;
export type Citation = FromSchema<typeof schemas.citation>;
export type Passage = Answer["citations"][number];

const ajv = new Ajv({ allowUnionTypes: true });
addFormats(ajv);
ajv.addKeyword("discriminator"); // The variants are already exclusive through their literal tags.

export const isAnswer = ajv.compile<Answer>(schemas.answer);
export const isWalkthrough = ajv.compile<Walkthrough>(schemas.walkthrough);
export const isPlayback = ajv.compile<Playback>(schemas.playback);
export const isCitation = ajv.compile<Citation>(schemas.citation);
