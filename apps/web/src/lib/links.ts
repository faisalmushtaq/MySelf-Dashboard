/** Where researchers edit and publish versions: MySelf Studio's survey list, in the survey's researcher view. */
export const STUDIO_URL: string = import.meta.env.VITE_STUDIO_URL ?? "https://faisalmushtaq.github.io/MySelf/researcher/#/surveys";
/** The participant app's address, which every participant link starts from (survey docs/16 §11.2). */
export const PARTICIPANT_URL: string = import.meta.env.VITE_PARTICIPANT_URL ?? "https://faisalmushtaq.github.io/MySelf/";

/** MySelf Studio's survey list for a study: the default study's pages have no study/ prefix. */
export function studioHome(study: { study: string; isDefault: boolean }): string {
  const base = STUDIO_URL.split("#")[0]!;
  return study.isDefault || !study.study ? `${base}#/surveys` : `${base}#/study/${encodeURIComponent(study.study)}/surveys`;
}
