# 셀프 마케팅 시스템 - 전체 스텝 진행표

## 현황 요약
- 26 HTML 페이지 / 36 DB 테이블 / 16 RPC 함수
- EventHub 이벤트 체인 연결 완료

---

## STEP 1: 핵심 인프라 점검 ✅
- [x] Supabase 연결 (config.js)
- [x] 36 DB 테이블 생성
- [x] 16 RPC 함수
- [x] EventHub 이벤트 체인
- [x] 공통 CSS/JS

## STEP 2: 랜딩 + 가격표 + 체험 신청 (고객 유입)
- [x] index.html - 랜딩 페이지
- [x] pricing.html - 패키지 + FAQ
- [x] trial.html - 3단계 플로우 (정보→카카오인증→시작)
- [ ] 실제 동작 테스트 + 버그 수정

## STEP 3: 핫리드 발굴 + 메시지 발송 (영업)
- [x] hotleads.html - 87K DB 탐색
- [x] messages.html - A/B/C 템플릿
- [ ] 메시지 발송 → EventHub 연동 확인
- [ ] 핫리드→고객 전환 흐름 테스트

## STEP 4: 카카오 자동응답 + 체험 시퀀스 (자동화)
- [x] kakao.html - 시퀀스 관리
- [x] trial-sequence.html - D+N 시퀀스
- [ ] 카카오 인증 → 시퀀스 자동생성 테스트
- [ ] 시퀀스 발송 처리 동작 확인

## STEP 5: 고객 생애주기 (운영)
- [x] customers.html - 7단계 관리
- [ ] 상태 전환 → EventHub 체인 테스트
- [ ] 이탈 위험 자동 감지 동작 확인

## STEP 6: 외주 + 결제 + 환불 (수익)
- [x] vendor.html - 주문서 포털
- [x] payments.html - 결제/실패/환불
- [ ] 유료 전환 → 주문서 자동생성 테스트
- [ ] 결제 실패 → 자동 대응 플로우 테스트

## STEP 7: 리마케팅 + 레퍼럴 + 커뮤니티 (성장)
- [x] remarketing.html - 4단계 퍼널
- [x] referral.html - 추천 프로그램
- [x] community.html - 커뮤니티 시딩
- [ ] 이탈→리마케팅 자동 연결 테스트
- [ ] 레퍼럴 전환 → 할인 적용 테스트

## STEP 8: 인텔리전스 (분석)
- [x] analytics.html - A/B + 캐시플로우
- [x] hypotheses.html - 가설 테스트
- [x] leaderboard.html - 매체 리더보드
- [x] constraints.html - 글로벌 제약
- [x] keywords.html - 키워드 확장 + 자기잠식
- [ ] 실 데이터 연동 확인

## STEP 9: 시스템 모니터링 (관리)
- [x] events.html - 이벤트 버스
- [x] audit.html - 감사 로그
- [x] decisions.html - AI 판단 로그
- [x] targets.html - 타겟 DB 고갈
- [x] kpi.html - KPI 대시보드
- [ ] 이벤트 실시간 수신 확인

## STEP 10: 대행사 + 멀티스토어 (확장)
- [x] agency.html - 대행사 파트너
- [ ] 볼륨 할인 자동 계산
- [ ] 멀티스토어 관리 기능

## STEP 11: 어드민 통합 대시보드 (최종)
- [x] admin.html - 마스터 대시보드
- [ ] 전체 페이지 사이드바 연결 확인
- [ ] 자동화 토글 7개 실제 동작
- [ ] 오늘 할 일 실시간 업데이트

## STEP 12: 최종 점검 + QA
- [ ] 전 페이지 모바일 반응형 (375px)
- [ ] 전 페이지 Supabase CRUD 동작
- [ ] EventHub 전체 체인 E2E 테스트
- [ ] 빈 상태(0건) UI 확인
- [ ] 에러 핸들링
- [ ] #KAKAO_URL 플레이스홀더 확인
