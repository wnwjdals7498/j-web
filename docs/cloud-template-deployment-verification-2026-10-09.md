# Task 25 WB-12 템플릿 배포 검증

POST `/web/sites/:id/deploy`는 저장된 `expectedRevision`과 일치하는 콘텐츠만
배포한다. 기존 수동 index와 관리 페이지의 수동 변경은 409로 거절하고 다른
SFTP·FTPS 파일은 보존한다. private hash manifest·site 잠금·원자 rename·비공개
직전 버전·중단 복구 journal을 사용한다. 파일 경로는 응답에 넣지 않는다.

계약은 불변 `@j-web/contracts@0.2.1`로 loopback registry에 게시했으며 내부 앱과
그룹웨어 소비자를 정확 버전으로 맞췄다. 중간 0.2.0은 덮어쓰지 않았다.

Node 22.18.0·24.19.0에서 package `check`와 실제 PostgreSQL·HTTPS 통합 15개가
각각 통과했다. 이후 review에서 발견한 pending journal의 backup UUID 재발급
오류를 고쳤고, 현재 helper로 수행한 실제 hosting 시험 5개도 두 런타임에서
통과했다. 신규 시험은 백업 전 중단, 원자 교체 후 state 확정 전 중단, 같은 ID·
백업 bytes의 재사용, 중복 요청과 잘못된 journal 거절을 확인한다.

공간 부족으로 새 Docker image build가 실패한 증거는 보존했다. 기존 전용 시험
image에 현재 helper를 읽기 전용으로 연결한 `compose.task25.yaml`을 사용했고
실행 container의 helper SHA-256과 소스의 일치를 검사했다. 운영 image·계정·
서비스 배포·CA trust·방화벽·VM은 변경하지 않았다.

실행 로그는 `/workspace/.suite-runtime/j-groupware/`의
`task25-web-check-final22.log/.exit`, `task25-web-check-final24.log/.exit`,
`task25-web-integration-final2-node22.log/.exit`,
`task25-web-integration-final-node24.log/.exit`,
`task25-web-journal-hosting-final-node22.log/.exit`,
`task25-web-journal-hosting-final-node24.log/.exit`다. 모두 exit 0이다.

그룹웨어의 후속 상담 origin 등록은 배포 성공과 별도로 다룬다. 상세 동시 쓰기
한계는 [hosting-contract.md](hosting-contract.md)를 따른다. 실제 VM 인수는 미실행이다.
