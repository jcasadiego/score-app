-- Versiones del cuestionario (PF-12). Lo que Prisma no expresa va al final, a mano:
-- un solo borrador por familia, CHECKs y el trigger que hace inmutable lo publicado.
BEGIN;

-- CreateEnum
CREATE TYPE "questionnaire_version_status" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'FREE_TEXT');

-- CreateTable
CREATE TABLE "questionnaire_versions" (
    "id" TEXT NOT NULL,
    "family" "diagnostic_family" NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "questionnaire_version_status" NOT NULL DEFAULT 'DRAFT',
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "published_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "questionnaire_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "questionnaire_version_id" TEXT NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "type" "question_type" NOT NULL,
    "help_text" VARCHAR(1000),
    "required" BOOLEAN NOT NULL,
    "max_length" INTEGER,
    "position" INTEGER NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_options" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "text" VARCHAR(300) NOT NULL,
    "value" VARCHAR(64) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "answer_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "questionnaire_versions_created_by_id_idx" ON "questionnaire_versions"("created_by_id");

-- CreateIndex
CREATE INDEX "questionnaire_versions_published_by_id_idx" ON "questionnaire_versions"("published_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_versions_family_version_number_key" ON "questionnaire_versions"("family", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "questions_questionnaire_version_id_code_key" ON "questions"("questionnaire_version_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "answer_options_question_id_value_key" ON "answer_options"("question_id", "value");

-- CreateIndex
CREATE UNIQUE INDEX "answer_options_id_question_id_key" ON "answer_options"("id", "question_id");

-- AddForeignKey
ALTER TABLE "questionnaire_versions" ADD CONSTRAINT "questionnaire_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_versions" ADD CONSTRAINT "questionnaire_versions_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_questionnaire_version_id_fkey" FOREIGN KEY ("questionnaire_version_id") REFERENCES "questionnaire_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_options" ADD CONSTRAINT "answer_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A lo sumo un borrador por familia, también ante peticiones simultáneas.
CREATE UNIQUE INDEX "questionnaire_versions_one_draft_per_family" ON "questionnaire_versions"("family") WHERE "status" = 'DRAFT';

ALTER TABLE "questionnaire_versions"
  ADD CONSTRAINT "questionnaire_versions_version_number_check" CHECK ("version_number" >= 1),
  -- Publicada si y solo si tiene fecha y quién la publicó.
  ADD CONSTRAINT "questionnaire_versions_published_check" CHECK (
    ("status" = 'PUBLISHED') = ("published_at" IS NOT NULL AND "published_by_id" IS NOT NULL)
  );

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_code_check" CHECK ("code" ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT "questions_position_check" CHECK ("position" >= 0),
  -- El largo máximo existe solo en texto libre, y ahí es obligatorio.
  ADD CONSTRAINT "questions_max_length_check" CHECK (
    ("type" = 'FREE_TEXT') = ("max_length" IS NOT NULL)
    AND ("max_length" IS NULL OR "max_length" BETWEEN 1 AND 5000)
  );

ALTER TABLE "answer_options"
  ADD CONSTRAINT "answer_options_value_check" CHECK ("value" ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT "answer_options_position_check" CHECK ("position" >= 0);

-- Una versión publicada no cambia: ni ella, ni sus preguntas, ni sus opciones. La
-- API ya lo valida; esto lo garantiza aunque alguien escriba directo en la base.
-- `FOR SHARE` espera a una publicación en curso, así que una escritura no se cuela
-- entre la validación y la publicación.
CREATE FUNCTION "questionnaire_version_is_published"(version_id TEXT) RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT "status" = 'PUBLISHED' FROM "questionnaire_versions" WHERE "id" = version_id FOR SHARE),
    false
  );
$$ LANGUAGE sql;

CREATE FUNCTION "questionnaire_versions_reject_published_change"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'PUBLISHED' THEN
    RAISE EXCEPTION 'questionnaire version % is published and cannot change', OLD."id"
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "questionnaire_versions_immutable_when_published"
  BEFORE UPDATE OR DELETE ON "questionnaire_versions"
  FOR EACH ROW EXECUTE FUNCTION "questionnaire_versions_reject_published_change"();

CREATE FUNCTION "questions_reject_published_change"() RETURNS trigger AS $$
BEGIN
  IF (TG_OP <> 'INSERT' AND "questionnaire_version_is_published"(OLD."questionnaire_version_id"))
    OR (TG_OP <> 'DELETE' AND "questionnaire_version_is_published"(NEW."questionnaire_version_id")) THEN
    RAISE EXCEPTION 'questions of a published questionnaire version cannot change'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "questions_immutable_when_published"
  BEFORE INSERT OR UPDATE OR DELETE ON "questions"
  FOR EACH ROW EXECUTE FUNCTION "questions_reject_published_change"();

CREATE FUNCTION "answer_options_reject_published_change"() RETURNS trigger AS $$
BEGIN
  IF (TG_OP <> 'INSERT' AND "questionnaire_version_is_published"(
        (SELECT "questionnaire_version_id" FROM "questions" WHERE "id" = OLD."question_id")))
    OR (TG_OP <> 'DELETE' AND "questionnaire_version_is_published"(
        (SELECT "questionnaire_version_id" FROM "questions" WHERE "id" = NEW."question_id"))) THEN
    RAISE EXCEPTION 'options of a published questionnaire version cannot change'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "answer_options_immutable_when_published"
  BEFORE INSERT OR UPDATE OR DELETE ON "answer_options"
  FOR EACH ROW EXECUTE FUNCTION "answer_options_reject_published_change"();

COMMIT;
