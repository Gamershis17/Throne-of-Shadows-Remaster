
// Update the directive panel from engine state
// Call: updateDirectivePanel(state, lootConfig)
function updateDirectivePanel(state, lootConfig) {
  if (typeof Engine === 'undefined') return;
  const result = Engine.selectOptimalFarmingZone(state, lootConfig, 150);
  const fr = Engine.getResistance(state, 'fire');

  document.querySelector('#directive-active .directive-zone').textContent =
    result.zone === 'Ready' ? '✅ Ready for Tier 1!' : `Farming: ${result.zone}`;
  document.querySelector('#directive-active .directive-reason').textContent = result.reason;

  document.getElementById('fr-current').textContent = fr;
  document.getElementById('fr-fill').style.width = Math.min(100, (fr / 150) * 100) + '%';

  const status = document.getElementById('fr-status');
  if (fr >= 150) {
    status.textContent = '✅ Raid ready!';
    status.classList.add('ready');
  } else {
    status.textContent = `Need ${150 - fr} more FR for Molten Depths`;
    status.classList.remove('ready');
  }

  // Logic breakdown: show efficiency scores for each zone
  const breakdown = document.getElementById('logic-breakdown');
  let html = '';
  for (const [zoneKey, zoneData] of Object.entries(lootConfig || {})) {
    for (const drop of (zoneData.drops || [])) {
      const gear = state.gear || state.loadout || {};
      const equipped = gear[drop.slot];
      const currentFR = (equipped && equipped.fire_resistance) || 0;
      if (drop.fire_resistance > currentFR) {
        const gain = drop.fire_resistance - currentFR;
        const time = zoneData.average_run_time_minutes || 25;
        const score = ((gain * (drop.drop_rate || 0.1)) / time).toFixed(3);
        const isBest = result.targetItem === drop.item_name;
        html += `<div class="logic-row" style="${isBest ? 'color:#fff;font-weight:700;' : ''}">`
          + `<span>${isBest ? '▶ ' : ''}${drop.item_name} (${zoneKey})</span>`
          + `<span class="logic-score">${score} FR/min</span></div>`;
      }
    }
  }
  breakdown.innerHTML = html || '<div>No upgrades available from dungeons.</div>';
}
