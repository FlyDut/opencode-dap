export const NON_INTERACTIVE_ENV: Record<string, string> = {
  CI: "true",
  GIT_PAGER: "cat",
  PAGER: "cat",
  TERM: "dumb",
  DEBIAN_FRONTEND: "noninteractive",
};
