import { useLinkBackup } from "./linkBackup";

/**
 * 「링크를 열기 전 판」 안내 — 보관한 판이 있는 동안만 보인다(`linkBackup.ts`). 두 탭
 * 모두의 옆 칸 맨 위에 둔다: 고르기 전까지 사라지지 않는 물음이라 먼저 보여야 한다.
 */
export function LinkBackupBanner() {
  const backup = useLinkBackup((s) => s.backup);
  const restore = useLinkBackup((s) => s.restore);
  const discard = useLinkBackup((s) => s.discard);
  if (!backup) return null;
  const n = backup.moves.length;
  return (
    <section className="panel panel--notice" aria-label="링크를 열기 전 판">
      <h2 className="panel__title">링크의 국면을 열었습니다</h2>
      <p className="panel__hint">
        두던 판({backup.name ? `${backup.name} · ` : ""}
        {n}수{backup.future.length ? ` + 무른 수 ${backup.future.length}` : ""})은 따로 보관해
        두었습니다.
      </p>
      <div className="panel__actions">
        <button type="button" className="button--primary" onClick={() => void restore()}>
          두던 판으로 돌아가기
        </button>
        <button type="button" onClick={() => void discard()}>
          버리기
        </button>
      </div>
    </section>
  );
}
