export const PASSMARK_PERCENTAGE = 70;

export const isPassingScore = (earnedScore, totalScore) => {
  const earned = Number(earnedScore);
  const total = Number(totalScore);
  return Number.isFinite(earned)
    && Number.isFinite(total)
    && total > 0
    && (earned / total) * 100 >= PASSMARK_PERCENTAGE;
};
