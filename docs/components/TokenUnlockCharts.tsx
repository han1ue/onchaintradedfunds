const REWARD_WEEKS = 208;
const REWARD_TOTAL = 700_000_000;
const DEPOSITOR_TOTAL = 650_000_000;
const WEEK_ONE_REWARD = 14_000_000;
const WEEKLY_DECAY = 0.9803203;

type RewardPoint = {
  week: number;
  depositors: number;
  creators: number;
  total: number;
};

function weeklyReward(week: number) {
  if (week < REWARD_WEEKS) return WEEK_ONE_REWARD * WEEKLY_DECAY ** (week - 1);
  const first207Weeks = WEEK_ONE_REWARD
    * (1 - WEEKLY_DECAY ** (REWARD_WEEKS - 1))
    / (1 - WEEKLY_DECAY);
  return REWARD_TOTAL - first207Weeks;
}

const rewardPoints: RewardPoint[] = [{ week: 0, depositors: 0, creators: 0, total: 0 }];
let cumulativeTotal = 0;
let cumulativeDepositors = 0;

for (let week = 1; week <= REWARD_WEEKS; week += 1) {
  const total = weeklyReward(week);
  const depositors = total * DEPOSITOR_TOTAL / REWARD_TOTAL;
  cumulativeTotal += total;
  cumulativeDepositors += depositors;
  rewardPoints.push({
    week,
    depositors: cumulativeDepositors,
    creators: cumulativeTotal - cumulativeDepositors,
    total: cumulativeTotal,
  });
}

const rewardCheckpoints = [0, 13, 26, 52, 104, 156, 208].map((week) => rewardPoints[week]!);

const REWARD_CHART = {
  width: 720,
  height: 320,
  left: 60,
  right: 24,
  top: 22,
  bottom: 46,
};

const rewardX = (week: number) => REWARD_CHART.left
  + week / REWARD_WEEKS * (REWARD_CHART.width - REWARD_CHART.left - REWARD_CHART.right);
const rewardY = (tokens: number) => REWARD_CHART.top
  + (1 - tokens / REWARD_TOTAL) * (REWARD_CHART.height - REWARD_CHART.top - REWARD_CHART.bottom);
const coordinate = (x: number, y: number) => `${x.toFixed(2)} ${y.toFixed(2)}`;

const depositorLine = rewardPoints
  .map((point, index) => `${index ? "L" : "M"} ${coordinate(rewardX(point.week), rewardY(point.depositors))}`)
  .join(" ");
const totalLine = rewardPoints
  .map((point, index) => `${index ? "L" : "M"} ${coordinate(rewardX(point.week), rewardY(point.total))}`)
  .join(" ");
const depositorArea = `${depositorLine} L ${coordinate(rewardX(REWARD_WEEKS), rewardY(0))} Z`;
const creatorArea = `${totalLine} ${[...rewardPoints].reverse()
  .map((point) => `L ${coordinate(rewardX(point.week), rewardY(point.depositors))}`)
  .join(" ")} Z`;

function millions(value: number) {
  if (value === 0) return "0 OTF";
  return `${(value / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M OTF`;
}

export function RewardsUnlockChart() {
  const yTicks = [0, 175_000_000, 350_000_000, 525_000_000, 700_000_000];
  const xTicks = [0, 52, 104, 156, 208];

  return (
    <figure className="tokenUnlockFigure" aria-labelledby="rewards-unlock-heading">
      <header className="tokenUnlockHeader">
        <div>
          <h3 id="rewards-unlock-heading">Cumulative incentive unlocks</h3>
          <p>Scheduled depositor and fund creator rewards across 208 weeks</p>
        </div>
        <div className="tokenUnlockLegend" aria-label="Chart legend">
          <span><i className="depositors" aria-hidden="true" />Depositors · 650M</span>
          <span><i className="creators" aria-hidden="true" />Fund creators · 50M</span>
        </div>
      </header>
      <div className="tokenUnlockChartScroll">
        <svg className="tokenUnlockChart" viewBox={`0 0 ${REWARD_CHART.width} ${REWARD_CHART.height}`} role="img" aria-labelledby="rewards-unlock-title rewards-unlock-description">
          <title id="rewards-unlock-title">Cumulative scheduled OTF incentive unlocks</title>
          <desc id="rewards-unlock-description">A stacked area chart rising from zero to 700 million OTF over four years. Depositors receive 650 million OTF and fund creators receive 50 million OTF on the same declining weekly schedule.</desc>
          {yTicks.map((tick) => {
            const y = rewardY(tick);
            return <g key={tick}><line className="tokenUnlockGrid" x1={REWARD_CHART.left} x2={REWARD_CHART.width - REWARD_CHART.right} y1={y} y2={y} /><text className="tokenUnlockAxisLabel" x={REWARD_CHART.left - 12} y={y + 4} textAnchor="end">{tick / 1_000_000}M</text></g>;
          })}
          {xTicks.map((tick) => {
            const x = rewardX(tick);
            return <g key={tick}><line className="tokenUnlockGrid vertical" x1={x} x2={x} y1={REWARD_CHART.top} y2={REWARD_CHART.height - REWARD_CHART.bottom} /><text className="tokenUnlockAxisLabel" x={x} y={REWARD_CHART.height - 18} textAnchor="middle">{tick === 0 ? "Start" : `Year ${tick / 52}`}</text></g>;
          })}
          <path className="tokenUnlockArea depositors" d={depositorArea} />
          <path className="tokenUnlockArea creators" d={creatorArea} />
          <path className="tokenUnlockLine total" d={totalLine} />
          <path className="tokenUnlockLine depositors" d={depositorLine} />
          <text className="tokenUnlockAxisTitle" x={REWARD_CHART.left} y={14}>Cumulative OTF</text>
          <text className="tokenUnlockEndpoint" x={REWARD_CHART.width - REWARD_CHART.right - 6} y={rewardY(REWARD_TOTAL) + 17} textAnchor="end">700M total</text>
        </svg>
      </div>
      <figcaption>The chart shows the publisher policy. Tokens become claimable only after the publisher includes the cumulative entitlement in an active Merkle root.</figcaption>
      <details className="tokenUnlockData">
        <summary>View cumulative checkpoint data</summary>
        <div><table><thead><tr><th>Checkpoint</th><th>Depositors</th><th>Fund creators</th><th>Total</th></tr></thead><tbody>{rewardCheckpoints.map((point) => <tr key={point.week}><td>{point.week === 0 ? "Start" : `Week ${point.week}`}</td><td>{millions(point.depositors)}</td><td>{millions(point.creators)}</td><td>{millions(point.total)}</td></tr>)}</tbody></table></div>
      </details>
    </figure>
  );
}

const TEAM_CHART = {
  width: 720,
  height: 300,
  left: 60,
  right: 24,
  top: 24,
  bottom: 50,
};

const teamX = (fdvMillions: number) => TEAM_CHART.left
  + fdvMillions / 10 * (TEAM_CHART.width - TEAM_CHART.left - TEAM_CHART.right);
const teamY = (tokensMillions: number) => TEAM_CHART.top
  + (1 - tokensMillions / 100) * (TEAM_CHART.height - TEAM_CHART.top - TEAM_CHART.bottom);
const teamSteps = Array.from({ length: 10 }, (_, index) => ({ fdv: index + 1, unlocked: (index + 1) * 10 }));
const teamStepLine = teamSteps.reduce(
  (path, step) => `${path} H ${teamX(step.fdv).toFixed(2)} V ${teamY(step.unlocked).toFixed(2)}`,
  `M ${coordinate(teamX(0), teamY(0))}`,
);
const teamStepArea = `${teamStepLine} V ${teamY(0).toFixed(2)} H ${teamX(0).toFixed(2)} Z`;

export function TeamUnlockChart() {
  const yTicks = [0, 25, 50, 75, 100];
  const xTicks = [0, 2, 4, 6, 8, 10];

  return (
    <figure className="tokenUnlockFigure team" aria-labelledby="team-unlock-heading">
      <header className="tokenUnlockHeader">
        <div>
          <h3 id="team-unlock-heading">Team allocation unlocks</h3>
          <p>10 million OTF per completed $1 million live-FDV milestone</p>
        </div>
        <strong>100M OTF · 10% of supply</strong>
      </header>
      <div className="tokenUnlockChartScroll">
        <svg className="tokenUnlockChart team" viewBox={`0 0 ${TEAM_CHART.width} ${TEAM_CHART.height}`} role="img" aria-labelledby="team-unlock-title team-unlock-description">
          <title id="team-unlock-title">Team OTF unlocks by live FDV milestone</title>
          <desc id="team-unlock-description">A step chart with ten milestones. Each completed one million dollar live FDV milestone unlocks ten million OTF, reaching the complete 100 million OTF team allocation at ten million dollars.</desc>
          {yTicks.map((tick) => {
            const y = teamY(tick);
            return <g key={tick}><line className="tokenUnlockGrid" x1={TEAM_CHART.left} x2={TEAM_CHART.width - TEAM_CHART.right} y1={y} y2={y} /><text className="tokenUnlockAxisLabel" x={TEAM_CHART.left - 12} y={y + 4} textAnchor="end">{tick}M</text></g>;
          })}
          {xTicks.map((tick) => {
            const x = teamX(tick);
            return <g key={tick}><line className="tokenUnlockGrid vertical" x1={x} x2={x} y1={TEAM_CHART.top} y2={TEAM_CHART.height - TEAM_CHART.bottom} /><text className="tokenUnlockAxisLabel" x={x} y={TEAM_CHART.height - 20} textAnchor="middle">${tick}M</text></g>;
          })}
          <path className="tokenUnlockArea team" d={teamStepArea} />
          <path className="tokenUnlockLine team" d={teamStepLine} />
          {teamSteps.map((step) => <circle className="tokenUnlockMilestone" key={step.fdv} cx={teamX(step.fdv)} cy={teamY(step.unlocked)} r="4" />)}
          <text className="tokenUnlockAxisTitle" x={TEAM_CHART.left} y={15}>Cumulative unlocked OTF</text>
          <text className="tokenUnlockAxisTitle x" x={TEAM_CHART.width - TEAM_CHART.right} y={TEAM_CHART.height - 4} textAnchor="end">Completed live FDV checkpoint</text>
        </svg>
      </div>
      <figcaption>A checkpoint rounds live FDV down to the last completed $1 million milestone. Once recorded, an unlocked tranche cannot relock.</figcaption>
      <details className="tokenUnlockData">
        <summary>View team milestone data</summary>
        <div><table><thead><tr><th>Completed live FDV</th><th>Cumulative unlocked</th><th>Share of supply</th></tr></thead><tbody>{teamSteps.map((step) => <tr key={step.fdv}><td>${step.fdv}M</td><td>{step.unlocked}M OTF</td><td>{step.fdv}%</td></tr>)}</tbody></table></div>
      </details>
    </figure>
  );
}
