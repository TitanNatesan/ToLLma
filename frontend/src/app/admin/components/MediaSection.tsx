"use client";

import { useMemo } from "react";
import { Film, HardDrive, Image as ImageIcon, Video } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { KpiCard } from "./KpiCard";
import { StackedBarChart } from "./StackedBarChart";
import { DonutBreakdown } from "./DonutBreakdown";
import { MediaTable } from "./tables";
import { fmtBucket, fmtBucketFull, fmtBytes, fmtCompact, fmtMoney, fmtNumber, toNumber } from "./format";
import type { AdminMedia } from "@/types/admin";

/** Media tab: image/video generation volume, storage and spend. */
export function MediaSection({ data }: { data: AdminMedia }) {
  const series = useMemo(
    () =>
      data.series.map((point) => ({
        bucket: point.bucket,
        images: point.images,
        videos: point.videos,
      })),
    [data.series],
  );

  const kindSlices = useMemo(
    () =>
      data.by_kind.map((row) => ({
        name: row.kind,
        value: row.count,
        hint: fmtMoney(row.cost),
      })),
    [data.by_kind],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="admin-media-kpis">
        <KpiCard
          label="Images"
          value={fmtNumber(data.images)}
          icon={<ImageIcon className="size-4" />}
          testId="admin-media-images"
        />
        <KpiCard
          label="Videos"
          value={fmtNumber(data.videos)}
          icon={<Video className="size-4" />}
          testId="admin-media-videos"
        />
        <KpiCard
          label="Stored media"
          value={fmtBytes(data.media_bytes)}
          icon={<HardDrive className="size-4" />}
          testId="admin-media-bytes"
        />
        <KpiCard
          label="Media spend"
          value={fmtMoney(toNumber(data.image_cost) + toNumber(data.video_cost))}
          sub={`${fmtMoney(data.image_cost)} images · ${fmtMoney(data.video_cost)} videos`}
          icon={<Film className="size-4" />}
          testId="admin-media-cost"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard
          title="Media by kind"
          description="Generated assets per media type."
          testId="admin-media-kinds"
        >
          <DonutBreakdown
            data={kindSlices}
            valueFormat={fmtNumber}
            ariaLabel="Donut chart of generated media by kind"
            testId="admin-media-kind-donut"
          />
        </SectionCard>

        <SectionCard
          title="Generation volume"
          description="Images and videos generated per day."
          className="xl:col-span-2"
          testId="admin-media-series"
        >
          <StackedBarChart
            data={series}
            series={[
              { key: "images", name: "Images" },
              { key: "videos", name: "Videos" },
            ]}
            valueFormat={fmtNumber}
            labelFormat={(label) => fmtBucket(String(label))}
            tooltipLabelFormat={(label) => fmtBucketFull(String(label))}
            axisFormat={fmtCompact}
            ariaLabel="Stacked bar chart of image and video generation over the selected period"
            testId="admin-media-chart"
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Media by model"
        description="Asset counts, storage and spend per model."
        testId="admin-media-models"
      >
        <MediaTable rows={data.by_model} testId="admin-media-models-table" />
      </SectionCard>

      <p className="text-right text-[10px] text-zinc-400">
        {fmtNumber(data.images)} images · metadata only, no media content is exposed to this console.
      </p>
    </div>
  );
}
