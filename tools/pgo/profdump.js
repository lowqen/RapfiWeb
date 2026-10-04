// PGO 계측 빌드 전용 --pre-js — LLVM 프로파일(.profraw)을 Emscripten 메모리 FS 에서 실제 디스크로 꺼낸다.
// (tools/build_engine_wasm.sh 가 PGO_GENERATE=1 일 때만 링크에 얹는다. 배포 빌드에는 들어가지 않는다.)
//
// 왜 여기서: 프로파일 런타임은 atexit 에서 "/default.profraw" 를 **메모리 FS** 에 쓴다. upstream 링크는
// EXIT_RUNTIME=1 이라 END → emscripten_force_exit → (atexit 실행) → Module.onExit → node process.exit 순서로
// 끝나는데, FS 는 모듈 안에서만 보이고 upstream 의 EXPORTED_RUNTIME_METHODS(['cwrap'])가 우리 -s 를 덮어
// FS 를 밖으로 내보낼 수도 없다. pre-js 는 모듈 안에서 돌므로 onExit 를 감싸 그 사이에 꺼낼 수 있다.
// upstream preamble.js 는 `Module["onExit"] = Module["onExit"] || …` 라 우리가 감싼 것을 그대로 둔다.
//
// 꺼낼 경로: 환경 변수 RAPFI_PROFRAW(기본 ./rapfi.profraw). Node 에서만 동작한다(브라우저에서는 건너뜀).
// 속성은 모두 대괄호로 — upstream 링크가 Closure 로 이 pre-js 까지 줄여 `process.env.X` 같은 점 표기 이름을 바꾼다
// (진단 37173142332 에서 RAPFI_PROFRAW 가 무시되고 기본 이름으로 떨어졌다).
(function () {
  var prev = Module["onExit"];
  Module["onExit"] = function (code) {
    if (typeof process !== "undefined" && process["versions"] && process["versions"]["node"]) {
      var out = (process["env"] && process["env"]["RAPFI_PROFRAW"]) || "rapfi.profraw";
      try {
        // 프런트엔드 계측은 default.profraw, IR 계측(-fprofile-generate)은 default_<id>.profraw — 루트의 .profraw 를 모두
        var names = FS.readdir("/").filter(function (n) {
          return /\.profraw$/.test(n);
        });
        if (names.length !== 1) throw new Error("루트의 .profraw 가 " + names.length + "개: " + names.join(","));
        var data = FS.readFile("/" + names[0]);
        require("fs")["writeFileSync"](out, data);
        process["stderr"]["write"]("[pgo] /" + names[0] + " " + data.length + " bytes -> " + out + "\n");
      } catch (e) {
        process["stderr"]["write"]("[pgo] 프로파일을 꺼내지 못함: " + e + "\n");
      }
    }
    if (prev) prev(code);
  };
})();
