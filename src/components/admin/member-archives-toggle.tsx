"use client";

import { useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

interface Archive {
  id: string;
  year: number;
  pdfUrl: string;
}

/** Small expandable link on a member row — lets an admin reach that member's archived (1+ year old) transaction history without leaving the members list. */
export function MemberArchivesToggle({ userId, lang }: { userId: string; lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [open, setOpen] = useState(false);
  const [archives, setArchives] = useState<Archive[] | null>(null);

  function toggle() {
    if (!open && archives === null) {
      fetch(`/api/admin/users/${userId}/archives`)
        .then((r) => r.json())
        .then((b) => setArchives(b.archives ?? []));
    }
    setOpen((o) => !o);
  }

  return (
    <div className="mt-1">
      <button
        onClick={toggle}
        className="font-label-sm text-label-sm text-primary underline flex items-center gap-1"
      >
        <span className="material-symbols-outlined text-[14px]">{open ? "expand_less" : "expand_more"}</span>
        {t("archivedHistoryTitle")}
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-1">
          {archives === null ? (
            <p className="font-label-sm text-label-sm text-on-surface-variant">…</p>
          ) : archives.length === 0 ? (
            <p className="font-label-sm text-label-sm text-on-surface-variant">—</p>
          ) : (
            archives.map((a) => (
              <a
                key={a.id}
                href={`/api/files/${a.pdfUrl}`}
                target="_blank"
                rel="noreferrer"
                className="font-label-sm text-label-sm text-on-surface-variant hover:text-primary flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">download</span>
                {a.year}
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
