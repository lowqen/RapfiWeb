import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RIF_PHASE_TEXT } from "./protocol";
import { fmtInt, fmtMB, fmtSec, rifFrom } from "./format";
import { useRifStore } from "./rifStore";

/**
 * 셸에 한 번 거는 W7 층 — **어느 화면에 `.rif` 를 떨어뜨려도** 변환을 시작하고, 진행 · 결과를 한 장의
 * 카드로 보인다(화면을 옮겨도 남는다).
 *
 * 놓는 동안: 파일을 끌고 들어오면 위에 한 줄 안내가 뜬다 — 끄는 중에는 브라우저가 파일 이름을
 * 알려 주지 않으므로 «.rif 면 어디든, 기보는 판에»를 함께 말한다. 놓으면:
 *   - `.rif` · `.xml` → 변환(보드의 기보 열기보다 먼저 가로챈다 — 창 단계 캡처)
 *   - 그 밖의 파일 → 보드가 받으면 보드의 것(기보 열기), 아무도 받지 않으면 브라우저가 파일을
 *     새 탭에 여는 것만 막는다
 */
export function RifImportLayer() {
  const importFile = useRifStore((s) => s.importFile);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      // 어디에 놓아도 «놓을 수 있다» — 그래야 판 밖에 놓은 .rif 도 drop 이 온다.
      if (hasFiles(e)) e.preventDefault();
    };
    const dropCapture = (e: DragEvent) => {
      depth.current = 0;
      setDragging(false);
      const rif = rifFrom(e.dataTransfer?.files);
      if (!rif) return;
      e.preventDefault();
      e.stopPropagation(); // 보드의 «기보 열기»에 닿지 않게
      void importFile(rif);
    };
    const dropBubble = (e: DragEvent) => {
      // 아무도 받지 않은 파일 — 브라우저가 그 파일로 탭을 바꾸지 않게만.
      if (hasFiles(e) && !e.defaultPrevented) e.preventDefault();
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", dropCapture, true);
    window.addEventListener("drop", dropBubble);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", dropCapture, true);
      window.removeEventListener("drop", dropBubble);
    };
  }, [importFile]);

  return (
    <>
      {dragging && (
        <div className="riftip" role="status">
          <b>RenjuNet .rif</b> 는 어디에 놓아도 오프닝 통계를 만듭니다 · 기보 파일은 판 위에
        </div>
      )}
      <RifProgressCard />
    </>
  );
}

/** 변환 진행 · 결과 · 실패 — 오른쪽 아래(좁은 화면은 아래 탭 위)에 한 장. */
function RifProgressCard() {
  const job = useRifStore((s) => s.job);
  const done = useRifStore((s) => s.done);
  const error = useRifStore((s) => s.error);
  const cancel = useRifStore((s) => s.cancel);
  const dismiss = useRifStore((s) => s.dismiss);
  const navigate = useNavigate();
  const [now, setNow] = useState(() => performance.now());

  // 경과 시간은 0.25초마다 — 진행 소식이 뜸한 정렬 단계에서도 시계가 흐르게.
  useEffect(() => {
    if (!job) return;
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, [job]);

  if (job) {
    const pct = Math.round(job.fraction * 100);
    // 시계 상태는 작업보다 먼저 잡혔을 수 있다 — 음수로 보이지 않게.
    const elapsed = Math.max(0, now - job.startedAt);
    return (
      <section className="rifjob" aria-live="polite" aria-label="RenjuNet 통계 만드는 중">
        <div className="rifjob__head">
          <span className="rifjob__title">RenjuNet 통계 만드는 중</span>
          <span className="rifjob__pct tnum">{pct}%</span>
        </div>
        <div
          className="rifjob__bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="변환 진행"
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="rifjob__meta tnum">
          {job.phase === "read"
            ? `${RIF_PHASE_TEXT.read} — ${fmtMB(job.loaded)} / ${fmtMB(job.fileSize)} · ${fmtInt(job.games)}판`
            : `${RIF_PHASE_TEXT[job.phase]} — ${fmtInt(job.games)}판`}
          <span className="rifjob__time">{fmtSec(elapsed)}</span>
        </p>
        <div className="rifjob__actions">
          <span className="rifjob__file" title={job.fileName}>
            {job.fileName}
          </span>
          <button type="button" className="btn" onClick={cancel}>
            취소
          </button>
        </div>
      </section>
    );
  }
  if (done) {
    return (
      <section
        className="rifjob rifjob--done"
        role="status"
        aria-label="RenjuNet 통계를 만들었습니다"
      >
        <div className="rifjob__head">
          <span className="rifjob__title">통계를 만들었습니다</span>
          <button type="button" className="rifjob__close" aria-label="닫기" onClick={dismiss}>
            ×
          </button>
        </div>
        <p className="rifjob__meta tnum" data-k="rif-done">
          {fmtInt(done.games)}판 · 국면 {fmtInt(done.positions)} · {fmtSec(done.ms)} · 저장{" "}
          {fmtMB(done.packBytes)}
        </p>
        {done.saveError && <p className="rifjob__warn">{done.saveError}</p>}
        <div className="rifjob__actions">
          <button
            type="button"
            className="btn btn--tonal"
            onClick={() => {
              dismiss();
              navigate("/research/ranking");
            }}
          >
            랭킹 보기
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              dismiss();
              navigate("/research/explorer");
            }}
          >
            오프닝 보기
          </button>
        </div>
      </section>
    );
  }
  if (error) {
    return (
      <section className="rifjob rifjob--error" role="alert">
        <div className="rifjob__head">
          <span className="rifjob__title">통계를 만들지 못했습니다</span>
          <button type="button" className="rifjob__close" aria-label="닫기" onClick={dismiss}>
            ×
          </button>
        </div>
        <p className="rifjob__meta">{error}</p>
      </section>
    );
  }
  return null;
}
