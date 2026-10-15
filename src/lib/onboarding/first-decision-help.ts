/**
 * In-app help for reaching a first Decision Case without a person walking
 * the user through it. Copy only. It does not start a case or grant access.
 */
export const FIRST_DECISION_HELP = {
  id: "first-decision-case",
  title: "Reach your first Decision Case",
  category: "Product",
  summary:
    "Ask, open a Decision Case, and review a recommendation from your own evidence.",
  content: [
    "You can reach a first Decision Case on Get started without a walkthrough.",
    "1. Write the engineering decision in your own words. Example buttons show the full question and only fill the Ask box. Exact example text is a preview and is not saved as your case.",
    "2. Choose what you are here to do. Connect my site is optional and comes after the question. You can paste a note or upload a file with no connector. Connecting a source only checks whether this workspace already has one.",
    "3. Continue, then save. A Decision Case in this browser is a draft. It is not done until that revision is saved on an evaluation workspace. Pricing and a sales conversation stay off this path.",
    "4. First value counts only after that save includes your evidence or a recommendation you can review. A note that is still only in this browser does not count. It is a deterministic evaluation of what you saved, not a live plant analysis, not an approval, and not permission to execute work.",
    "5. Record your own decision and how you will verify the outcome. Sync recommends. You authorize.",
    "Talk me through it speaks the current step only when Voice output is enabled for this workspace and this browser is not muted. Otherwise the button stays off and no speech request is made.",
    "Talk to us is available if you want a person. It is not required to reach a Decision Case or first value.",
  ].join("\n\n"),
} as const;
