-- One row per generation request. Written at the end of a successful pipeline run, so
-- the table is a record of images that exist, not of attempts.
--
-- Prompts are the reason this table exists: `original_prompt` is what the user typed and
-- `enhanced_prompt` is what the image model actually received, which is what we tune.

CREATE TABLE IF NOT EXISTS generations (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at       timestamptz  NOT NULL DEFAULT now(),

  -- Prompts.
  original_prompt  text         NOT NULL,
  enhanced_prompt  text         NOT NULL,
  -- False when the text model failed and the pipeline fell through to the raw prompt,
  -- in which case enhanced_prompt equals original_prompt.
  enhanced         boolean      NOT NULL,

  -- Who asked. Personal data under GDPR: kept raw for per-visitor debugging, which means
  -- this table is in scope for any deletion request.
  client_ip        inet,

  -- Where the image lives permanently. Null until the background upload finishes, and
  -- stays null if UploadThing is unconfigured or the upload failed.
  image_url        text,
  image_key        text,

  -- Generation parameters, for reproducing a result.
  mode             text         NOT NULL,
  aspect_ratio     text         NOT NULL,
  quality          text         NOT NULL,
  width            integer      NOT NULL,
  height           integer      NOT NULL,
  seed             bigint       NOT NULL,

  -- Which models did the work. The image model is the one that actually rendered, which
  -- differs from the configured primary whenever a fallback stepped in.
  text_model       text         NOT NULL,
  image_model      text         NOT NULL,

  duration_ms      integer      NOT NULL
);

-- The two queries this table is for: recent generations, and everything from one visitor.
CREATE INDEX IF NOT EXISTS generations_created_at_idx ON generations (created_at DESC);
CREATE INDEX IF NOT EXISTS generations_client_ip_idx  ON generations (client_ip);
