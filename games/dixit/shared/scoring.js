/**
 * 라운드 점수 계산 (공식 룰 기준)
 *
 * @param {string}   storytellerId
 * @param {Array<{playerId:string, cardId:string}>} submissions  - 스토리텔러 포함
 * @param {Array<{voterId:string,  cardId:string}>} votes        - 스토리텔러 제외
 * @param {string[]} allPlayerIds
 * @returns {{ deltas: {[id:string]:number}, scoringCase: string }}
 */
export function calculateRoundScores(storytellerId, submissions, votes, allPlayerIds) {
  const storyCardId    = submissions.find(s => s.playerId === storytellerId)?.cardId;
  const nonStorytellers = allPlayerIds.filter(id => id !== storytellerId);
  const correctVoters  = votes.filter(v => v.cardId === storyCardId).map(v => v.voterId);

  const allCorrect = correctVoters.length === nonStorytellers.length;
  const allWrong   = correctVoters.length === 0;

  const deltas = Object.fromEntries(allPlayerIds.map(id => [id, 0]));

  if (!allCorrect && !allWrong) {
    // 일부만 정답: 스토리텔러 +3, 정답자 +3
    deltas[storytellerId] += 3;
    for (const id of correctVoters) deltas[id] += 3;
  } else {
    // 전원 정답 또는 전원 오답: 스토리텔러 0, 비-스토리텔러 +2
    for (const id of nonStorytellers) deltas[id] += 2;
  }

  // 미끼 카드 보너스: 내 카드에 투표가 들어올 때마다 +1 (스토리텔러 카드 제외)
  for (const vote of votes) {
    const owner = submissions.find(s => s.cardId === vote.cardId)?.playerId;
    if (owner && owner !== storytellerId) {
      deltas[owner] += 1;
    }
  }

  const scoringCase = allCorrect ? 'all-correct' : allWrong ? 'all-wrong' : 'partial';
  return { deltas, scoringCase };
}
