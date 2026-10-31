// ── Friendly drive names ────────────────────────────────────────────────────
// "WDC WD80EFAX-68KNBN0" → "WD Red 8 TB". SMART reports the part number, and
// neither smartmon nor node_exporter reports a drive's capacity, but WD and
// Seagate encode both the family and the size in it. Anything not recognised
// returns null and the panel shows the part number as-is. Pure, client-safe.

// WD: the letters after the size digits name the family.
const WD_FAMILIES: [RegExp, string][] = [
  [/^(EFRX|EFAX)$/,                "WD Red"],
  [/^(EFZX|EFPX|EFZZ|EFBX)$/,      "WD Red Plus"],
  [/^(FFBX|FFWX|FFSX|KFBX|KFGX|NFAX|KFAX)$/, "WD Red Pro"],
  [/^(PURZ|PURX|PUSX)$/,           "WD Purple"],
  [/^(PURP)$/,                     "WD Purple Pro"],
  [/^(EZAZ|EZRZ|EZEX|EZRX|EZDZ|EAZZ|EZAX)$/, "WD Blue"],
  [/^(FZBX|FZWX|FZEX)$/,           "WD Black"],
  [/^(FYYZ|FRYZ|KRYZ|FYYG|KRYG)$/, "WD Gold"],
];

// Seagate: the two letters after the size in GB name the family.
const SEAGATE_FAMILIES: Record<string, string> = {
  VN: "Seagate IronWolf", NE: "Seagate IronWolf Pro", NT: "Seagate IronWolf Pro",
  NM: "Seagate Exos", DM: "Seagate BarraCuda", VX: "Seagate SkyHawk",
};

const tb = (n: number) => (n >= 1 ? `${Number.isInteger(n) ? n : n.toFixed(1)} TB` : `${Math.round(n * 1000)} GB`);

// WD size digits: 2 → tenths of a TB (WD40 = 4 TB, WD10 = 1 TB); 3 → the
// first two are TB (WD101 = 10 TB, WD240 = 24 TB); 4 → the first is TB
// (WD4003 = 4 TB).
function wdCapacity(digits: string): number | null {
  if (digits.length === 2) return Number(digits) / 10;
  if (digits.length === 3) return Number(digits.slice(0, 2));
  if (digits.length === 4) return Number(digits[0]);
  return null;
}

export function friendlyDriveName(model: string | null | undefined): string | null {
  if (!model) return null;
  const m = model.trim().replace(/^WDC\s+/i, "").toUpperCase();

  const wd = m.match(/^WD(\d{2,4})([A-Z]{4})/);
  if (wd) {
    const family = WD_FAMILIES.find(([re]) => re.test(wd[2]))?.[1];
    const size = wdCapacity(wd[1]);
    return family && size ? `${family} ${tb(size)}` : null;
  }

  const sg = m.match(/^ST(\d{3,5})([A-Z]{2})/);
  if (sg) {
    const family = SEAGATE_FAMILIES[sg[2]];
    return family ? `${family} ${tb(Number(sg[1]) / 1000)}` : null;
  }

  return null;
}
