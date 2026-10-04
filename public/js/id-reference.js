// ============================================================
// id-reference.js — Live ID Reference for GM Console.
// Builds searchable lists of Pet, Item/Gear, Title, and Quest IDs
// from the engine's exported definitions. Used by staff.html sidebar
// and the in-game Staff tab toggle panel.
// ============================================================

import * as Engine from './engine.js?v20261003bi';

// Gear sets available for GM grants (mirrors server gearSets.js).
const GEAR_SETS = [
  { id: 'sovereign', name: 'Sovereign', desc: 'Owner-only set' },
  { id: 'fateweaver', name: 'Fateweaver', desc: 'Fate-themed set' },
  { id: 'warden', name: 'Warden', desc: 'Warden set' },
  { id: 'voidwalker', name: 'Voidwalker', desc: 'Void-themed set' },
  { id: 'dragonscale', name: 'Dragonscale', desc: 'Dragon-themed set' },
  { id: 'gamemaster', name: 'Game Master', desc: 'GM set' },
];
const GEAR_SLOTS = ['weapon', 'armor', 'helmet', 'boots', 'trinket'];

/**
 * Build the full ID reference: { pets, items, titles, quests }.
 * Each entry: { id, name, emoji?, desc? }.
 */
export function buildIdReference() {
  const pets = [];
  try {
    const species = Engine.PET_SPECIES || {};
    for (const [id, def] of Object.entries(species)) {
      pets.push({
        id,
        name: def.name || id,
        emoji: def.emoji || '🐾',
        desc: def.rarity || '',
      });
    }
  } catch { /* ignore */ }

  const items = [];
  try {
    for (const set of GEAR_SETS) {
      for (const slot of GEAR_SLOTS) {
        items.push({
          id: `${set.id}:${slot}`,
          name: `${set.name} ${slot}`,
          emoji: '⚔️',
          desc: `Grant: set=${set.id} slot=${slot}`,
        });
      }
    }
  } catch { /* ignore */ }

  const titles = [];
  try {
    const defs = Engine.TITLE_DEFS || {};
    for (const [id, def] of Object.entries(defs)) {
      titles.push({
        id,
        name: def.name || id,
        emoji: '🏷️',
        desc: def.desc || '',
      });
    }
  } catch { /* ignore */ }

  const quests = [];
  try {
    const qdefs = Engine.QUEST_DEFS || [];
    for (const q of qdefs) {
      if (q && q.id) {
        quests.push({
          id: q.id,
          name: q.name || q.id,
          emoji: '📜',
          desc: q.desc || '',
        });
      }
    }
    const sqdefs = Engine.STORY_QUEST_DEFS || [];
    for (const q of sqdefs) {
      if (q && q.id) {
        quests.push({
          id: q.id,
          name: (q.name || q.id) + ' (story)',
          emoji: '📖',
          desc: q.desc || '',
        });
      }
    }
  } catch { /* ignore */ }

  return { pets, items, titles, quests };
}

/**
 * Render the ID reference panel into a container element.
 * Options:
 *   onCopy(id) — called when an ID is clicked (default: copy to clipboard).
 */
export function renderIdReference(container, options = {}) {
  if (!container) return;
  const ref = buildIdReference();
  const onCopy = options.onCopy || ((id) => {
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(id);
    } catch { /* ignore */ }
  });

  const categories = [
    { key: 'pets', label: '🐾 Pet IDs', items: ref.pets },
    { key: 'items', label: '⚔️ Item & Gear IDs', items: ref.items },
    { key: 'titles', label: '🏷️ Title IDs', items: ref.titles },
    { key: 'quests', label: '📜 Quest IDs', items: ref.quests },
  ];

  container.innerHTML = `
    <div class="idref-wrap">
      <div class="idref-search-row">
        <input type="text" class="idref-search" placeholder="🔍 Search IDs..." aria-label="Search IDs" />
      </div>
      <div class="idref-cats">
        ${categories.map((c) => `
          <div class="idref-cat" data-cat="${c.key}">
            <div class="idref-cat-head">${c.label} <span class="idref-count">(${c.items.length})</span></div>
            <div class="idref-items">
              ${c.items.map((item) => `
                <button class="idref-badge" data-id="${escapeAttr(item.id)}" title="${escapeAttr(item.desc || item.name)} — click to copy">
                  <span class="idref-emoji">${item.emoji || ''}</span>
                  <span class="idref-id">${escapeHtml(item.id)}</span>
                </button>`).join('')}
            </div>
          </div>`).join('')}
      </div>
      <div class="idref-hint">Click any ID to copy it to your clipboard.</div>
    </div>`;

  // Search/filter
  const searchInput = container.querySelector('.idref-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      container.querySelectorAll('.idref-cat').forEach((cat) => {
        let visible = 0;
        cat.querySelectorAll('.idref-badge').forEach((badge) => {
          const id = (badge.dataset.id || '').toLowerCase();
          const match = !q || id.includes(q);
          badge.style.display = match ? '' : 'none';
          if (match) visible++;
        });
        cat.style.display = visible ? '' : 'none';
        const countEl = cat.querySelector('.idref-count');
        if (countEl) countEl.textContent = `(${visible})`;
      });
    });
  }

  // Click-to-copy
  container.querySelectorAll('.idref-badge').forEach((badge) => {
    badge.addEventListener('click', () => {
      const id = badge.dataset.id;
      if (!id) return;
      onCopy(id);
      // Visual feedback
      badge.classList.add('copied');
      setTimeout(() => badge.classList.remove('copied'), 600);
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
