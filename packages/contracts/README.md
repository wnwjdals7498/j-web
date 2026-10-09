# @j-web/contracts

고정 내부 j-web 회원 API의 정확 버전 계약이다. 사이트/호스팅 상태·페이지 콘텐츠·
revision·readonly 미리보기·DNS 안내·계정 원문1회·부분 실패 DTO를 제공한다.
실행 정책 H7의 public-root 교체·보관·deploy 요청은 승인 전이며
`DeploymentGate`만 이를 표시한다. 배포 실행·visitor·UI 완료 계약으로 게시하지 않는다.

콘텐츠는 name/introduction/contact의 UTF-8 bytes 상한 120/4096/512와 nullable
logo다. 로고는 canonical base64의 정적 PNG RGB/RGBA8·비인터레이스, 1MiB 이하,
각 변1024 이하, IHDR/연속 IDAT/IEND·CRC·bounded inflate만 받는다.
부가 metadata·SVG·URL·애니메이션·외부 경로는 받지 않는다. 이 제한은 입력
검증의 작은 기술 범위이며 수동 파일 교체·보존 정책이나 UI 디자인 결정이 아니다.

GET `/web/sites/hosting`은 실제 용량/마운트 결과와 저장된 상태·실패 단계를
분리한다. GET `/:id/dns`는 A 레코드와 hosts 안내만 제공하고 DNS 변경을 하지 않는다.
GET/PUT `/:id/content`는 PostgreSQL에만 저장한다. PUT은 expectedRevision이
현재 값(처음0)과 같아야 하고 stale·동시 변경은409다. POST `/:id/preview`는
escape한 HTML과 고정 익명 widget 한 줄을 JSON으로 반환하며 script를 CSP로 막는다.
배포/공개 root 수정은 없다. 모든 경로는 `/web/sites` 아래다.
