/**
 * W1 의 화면 자리표시자.
 *
 * 빈 div 를 두지 않는 이유: 스캐폴딩을 다시 여는 사람(또는 미래의 우리)에게
 * «여기가 무엇이 될 자리인지»와 «무엇이 먼저 끝나야 하는지»를 화면이 직접
 * 말해 주는 편이 낫다. 각 화면이 채워지면 이 컴포넌트는 통째로 사라진다.
 */
export function Placeholder({
  stage,
  title,
  what,
  needs,
}: {
  stage: string;
  title: string;
  what: string;
  needs?: readonly string[];
}) {
  return (
    <section className="placeholder">
      <div className="placeholder__card">
        <span className="placeholder__stage">{stage}</span>
        <h2 className="placeholder__title">{title}</h2>
        <p className="placeholder__what">{what}</p>
        {needs && needs.length > 0 && (
          <p className="placeholder__needs">
            먼저 필요한 것: {needs.join(" · ")}
          </p>
        )}
      </div>
    </section>
  );
}
