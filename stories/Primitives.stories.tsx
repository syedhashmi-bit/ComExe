import type { Meta, StoryObj } from "@storybook/react";
import {
  AnimatedNumber, GaugeBar, Sparkline, RadialGauge, BigValue,
  Card, Skeleton, SubRow, StatRow, LabeledBar, TrendDelta, HeroStat,
  StatusBanner,
} from "@/app/components/primitives";

// ── AnimatedNumber ──────────────────────────────────────────────────────────

const AnimMeta: Meta<typeof AnimatedNumber> = {
  title: "Primitives/AnimatedNumber",
  component: AnimatedNumber,
};
export default AnimMeta;
type AnimStory = StoryObj<typeof AnimatedNumber>;

export const Default: AnimStory = { args: { value: 73.5, decimals: 1 } };
export const Integer: AnimStory = { args: { value: 1024, decimals: 0, useCommas: true } };

// ── GaugeBar ────────────────────────────────────────────────────────────────

export const GaugeBarDefault: StoryObj<typeof GaugeBar> = {
  render: () => (
    <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 12 }}>
      <GaugeBar percent={25} color="#10b981" />
      <GaugeBar percent={60} color="#06b6d4" />
      <GaugeBar percent={85} color="#f59e0b" />
      <GaugeBar percent={97} color="#ef4444" />
      <GaugeBar percent={50} color="#8b5cf6" thin />
    </div>
  ),
};

// ── Sparkline ───────────────────────────────────────────────────────────────

export const SparklineDefault: StoryObj<typeof Sparkline> = {
  render: () => {
    const data = Array.from({ length: 60 }, () => Math.random() * 100);
    return (
      <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 12 }}>
        <Sparkline data={data} color="#06b6d4" />
        <Sparkline data={data.map(d => d * 0.5)} color="#10b981" autoMax />
        <Sparkline data={data.map(d => d * 1.5)} color="#ef4444" height={48} />
      </div>
    );
  },
};

// ── RadialGauge ─────────────────────────────────────────────────────────────

export const RadialGaugeDefault: StoryObj<typeof RadialGauge> = {
  render: () => (
    <div style={{ display: "flex", gap: 20 }}>
      <RadialGauge percent={25} color="#10b981" />
      <RadialGauge percent={65} color="#06b6d4" />
      <RadialGauge percent={90} color="#ef4444" size={120} />
    </div>
  ),
};

// ── BigValue ────────────────────────────────────────────────────────────────

export const BigValueDefault: StoryObj<typeof BigValue> = {
  render: () => (
    <div style={{ display: "flex", gap: 20 }}>
      <BigValue value="42.5%" />
      <BigValue value="1,234 MB" />
      <BigValue value="—" loading />
    </div>
  ),
};

// ── Card ────────────────────────────────────────────────────────────────────

export const CardDefault: StoryObj<typeof Card> = {
  render: () => (
    <div style={{ width: 360 }}>
      <Card label="CPU" accent="#06b6d4" icon={<span>🔲</span>}>
        <GaugeBar percent={72} color="#06b6d4" />
        <SubRow label="Cores" value="12" />
        <SubRow label="Temp" value="65°C" />
      </Card>
    </div>
  ),
};

export const CardWarning: StoryObj<typeof Card> = {
  render: () => (
    <div style={{ width: 360 }}>
      <Card label="Memory" accent="#10b981" icon={<span>📊</span>} alertLevel="warning">
        <GaugeBar percent={87} color="#f59e0b" />
        <SubRow label="Used" value="13.5 GB" />
      </Card>
    </div>
  ),
};

export const CardCritical: StoryObj<typeof Card> = {
  render: () => (
    <div style={{ width: 360 }}>
      <Card label="Disk" accent="#f59e0b" icon={<span>💾</span>} alertLevel="critical">
        <GaugeBar percent={96} color="#ef4444" />
        <SubRow label="/mnt/Pool" value="96%" valueColor="#ef4444" />
      </Card>
    </div>
  ),
};

// ── Skeleton ────────────────────────────────────────────────────────────────

export const SkeletonDefault: StoryObj<typeof Skeleton> = {
  render: () => (
    <div style={{ width: 360, display: "flex", flexDirection: "column", gap: 8 }}>
      <Skeleton />
      <Skeleton />
    </div>
  ),
};

// ── LabeledBar ──────────────────────────────────────────────────────────────

export const LabeledBarDefault: StoryObj<typeof LabeledBar> = {
  render: () => (
    <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 8 }}>
      <LabeledBar label="/mnt/Pool/Media/Movies" right="72%" percent={72} color="#f59e0b" />
      <LabeledBar label="/mnt/Pool/Media/TV"     right="45%" percent={45} color="#06b6d4" />
      <LabeledBar label="/mnt/Pool/Media/Music"  right="12%" percent={12} color="#10b981" />
    </div>
  ),
};

// ── SubRow / StatRow ────────────────────────────────────────────────────────

export const RowVariants: StoryObj = {
  render: () => (
    <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 4 }}>
      <SubRow label="Temperature" value="65°C" />
      <SubRow label="Warning" value="HOT" valueColor="#ef4444" />
      <StatRow label="Uptime" value="14d 6h 32m" />
    </div>
  ),
};

// ── TrendDelta ──────────────────────────────────────────────────────────────

export const TrendDeltaDefault: StoryObj<typeof TrendDelta> = {
  render: () => (
    <div style={{ display: "flex", gap: 20 }}>
      <TrendDelta current={75} history={[60, 65, 70]} goodDirection="down" />
      <TrendDelta current={30} history={[50, 45, 40]} goodDirection="down" />
      <TrendDelta current={150} history={[100, 120, 140]} goodDirection="up" />
    </div>
  ),
};

// ── HeroStat ────────────────────────────────────────────────────────────────

export const HeroStatDefault: StoryObj<typeof HeroStat> = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <HeroStat line="16,173 queries today" keyPrefix="s1" />
      <HeroStat line="42.5 Mbps download" keyPrefix="s2" />
      <HeroStat line="3 active streams" keyPrefix="s3" />
    </div>
  ),
};

// ── StatusBanner ────────────────────────────────────────────────────────────

export const StatusBannerVariants: StoryObj<typeof StatusBanner> = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 400 }}>
      <StatusBanner result={{ status: "healthy", reason: "All systems operational" }} visible />
      <StatusBanner result={{ status: "warning", reason: "CPU temperature elevated" }} visible />
      <StatusBanner result={{ status: "critical", reason: "Disk usage above 95%" }} visible />
    </div>
  ),
};
