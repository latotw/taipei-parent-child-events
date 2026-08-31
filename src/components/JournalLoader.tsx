"use client";

import dynamic from "next/dynamic";

import JournalSkeleton from "@/components/JournalSkeleton";
import { PassphraseProvider } from "@/components/PassphraseProvider";
import { WorkspaceProvider } from "@/components/WorkspaceProvider";

/**
 * 日記畫面的內容取決於「使用者所在時區的今天」與當下時間，
 * 因此只在瀏覽器端渲染，伺端先送出骨架畫面，避免 hydration 不一致。
 */
const GratitudeJournal = dynamic(
  () => import("@/components/GratitudeJournal"),
  { ssr: false, loading: () => <JournalSkeleton /> },
);

export default function JournalLoader() {
  return (
    <WorkspaceProvider>
      <PassphraseProvider>
        <GratitudeJournal />
      </PassphraseProvider>
    </WorkspaceProvider>
  );
}
