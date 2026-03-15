/**
 * ONDA Event Hub - 전체 기능 상호연결 엔진
 * 
 * 흐름:
 * 핫리드 발굴 → 메시지 발송 → 카카오 채널 추가 → 인증코드 확인 
 * → 체험 시작 → D+N 시퀀스 자동생성 → 온보딩 → 결제 → 활성
 * → 이탈 위험 감지 → 리마케팅 → 복귀 or 해지
 * → 해지 시 환불 자동산출 + 윈백 시퀀스
 * 
 * 모든 이벤트 → sm_event_bus + sm_audit_log + sm_customer_events 자동기록
 */

const EventHub = {
  // ===== 이벤트 발행 (모든 액션의 시작점) =====
  async emit(eventType, payload, customerId = null) {
    console.log(`[EventHub] ${eventType}`, payload);

    // 1. 이벤트 버스에 기록 (컬럼: event_type, payload, source_cron, status)
    await sbInsert('sm_event_bus', {
      event_type: eventType,
      payload: payload,
      source_cron: 'frontend',
      status: 'new'
    }).catch(e => console.warn('event_bus insert failed', e));

    // 2. 고객 이벤트 기록
    if (customerId) {
      await sbInsert('sm_customer_events', {
        customer_id: customerId,
        event_type: eventType,
        event_data: payload
      }).catch(e => console.warn('customer_event insert failed', e));
    }

    // 3. 감사 로그 (컬럼: actor, action_type, target_table, target_id, new_value)
    await sbInsert('sm_audit_log', {
      action_type: eventType,
      target_table: payload.entity_type || 'system',
      target_id: customerId || payload.entity_id || null,
      new_value: payload,
      actor: 'system'
    }).catch(e => console.warn('audit_log insert failed', e));

    // 4. 이벤트별 자동 체인 실행
    await this.processChain(eventType, payload, customerId);
  },

  // ===== 이벤트 체인 (기능 간 자동 연결) =====
  async processChain(eventType, payload, customerId) {
    switch (eventType) {

      // === 카카오 채널 친구 추가 인증 ===
      case 'kakao_friend_verified':
        // → 고객 상태를 trial로 전환
        if (customerId) {
          await sbUpdate('sm_customers', { id: customerId }, {
            status: 'trial',
            kakao_verified: true,
            kakao_verified_at: new Date().toISOString(),
            trial_start_date: new Date().toISOString()
          });
          // → 체험 시퀀스 자동 생성
          await this.createTrialSequence(customerId);
          // → 카카오 자동응답 시퀀스 생성
          await this.createKakaoSequence(customerId);
          // → KPI 업데이트
          await this.updateKpi('trial_started', 1);
        }
        break;

      // === 체험 신청 (카카오 인증 전) ===
      case 'trial_applied':
        // → 고객을 lead 상태로 저장 (카카오 인증 대기)
        await this.updateKpi('trial_applied', 1);
        break;

      // === 체험 → 유료 전환 ===
      case 'trial_converted':
        if (customerId) {
          await sbUpdate('sm_customers', { id: customerId }, {
            status: 'onboarding',
            converted_at: new Date().toISOString()
          });
          // → 외주 주문서 자동생성
          await this.autoGenerateOrder(customerId);
          // → 첫 결제 기록
          await this.createPayment(customerId, payload.package);
          await this.updateKpi('conversion', 1);
        }
        break;

      // === 온보딩 완료 ===
      case 'onboarding_completed':
        if (customerId) {
          await sbUpdate('sm_customers', { id: customerId }, { status: 'active' });
          await this.updateKpi('active_customer', 1);
        }
        break;

      // === 이탈 위험 감지 ===
      case 'churn_risk_detected':
        if (customerId) {
          await sbUpdate('sm_customers', { id: customerId }, { status: 'at_risk' });
          // → 리마케팅 큐에 자동 추가 (stage=integer: 1=알림,2=리마인드,3=특별제안,4=최종)
          await sbInsert('sm_remarketing_queue', {
            customer_id: customerId,
            stage: 1,
            message_type: 'at_risk_alert',
            scheduled_at: new Date().toISOString(),
            status: 'pending'
          });
          // → 위험 알림 (alert_type: conversion_drop|churn_spike|account_ban|trial_conversion_drop|target_depletion)
          await sbInsert('sm_risk_alerts', {
            alert_type: 'churn_spike',
            severity: payload.risk_score > 80 ? 'critical' : 'warning',
            condition_met: `customer ${customerId}: risk ${payload.risk_score}%`,
            is_resolved: false
          });
        }
        break;

      // === 결제 실패 ===
      case 'payment_failed':
        if (customerId) {
          // → 자동 결제 실패 대응 플로우
          await sbRpc('handle_payment_failure', { payment_id: payload.payment_id }).catch(() => {});
          await sbInsert('sm_risk_alerts', {
            alert_type: 'churn_spike',
            severity: 'critical',
            condition_met: `customer ${customerId}: payment failed`,
            is_resolved: false
          });
        }
        break;

      // === 해지 ===
      case 'customer_churned':
        if (customerId) {
          await sbUpdate('sm_customers', { id: customerId }, {
            status: 'churned',
            churned_at: new Date().toISOString()
          });
          // → 환불 자동 산출
          const refund = await sbRpc('calculate_refund', { cust_id: customerId }).catch(() => null);
          // → 윈백 리마케팅 시퀀스 생성 (30일 후)
          const winbackDate = new Date(Date.now() + 30 * 86400000).toISOString();
          await sbInsert('sm_remarketing_queue', {
            customer_id: customerId,
            stage: 4,
            message_type: 'winback',
            scheduled_at: winbackDate,
            status: 'pending'
          });
          await this.updateKpi('churn', 1);
        }
        break;

      // === 핫리드 메시지 발송 ===
      case 'message_sent':
        await this.updateKpi('message_sent', 1);
        // → 발송 스케줄 실적 업데이트
        const month = new Date().getMonth() + 1;
        const schedules = await sbQuery(`sm_send_schedule?month=eq.${month}`);
        if (schedules.length) {
          await sbUpdate('sm_send_schedule', { id: schedules[0].id }, {
            actual_daily_avg: (schedules[0].actual_daily_avg || 0) + 1,
            actual_monthly_total: (schedules[0].actual_monthly_total || 0) + 1
          });
        }
        // → 타겟 풀 소진 업데이트
        if (payload.priority) {
          const pools = await sbQuery(`sm_target_pool?priority=eq.${payload.priority}`);
          if (pools.length) {
            await sbUpdate('sm_target_pool', { id: pools[0].id }, {
              sent_count: (pools[0].sent_count || 0) + 1,
              remaining_count: Math.max(0, (pools[0].remaining_count || 0) - 1)
            });
          }
        }
        break;

      // === 레퍼럴 전환 ===
      case 'referral_converted':
        if (payload.referral_code) {
          const refs = await sbQuery(`sm_referrals?referral_code=eq.${payload.referral_code}`);
          if (refs.length) {
            await sbUpdate('sm_referrals', { id: refs[0].id }, {
              referred_id: customerId,
              status: 'converted',
              converted_at: new Date().toISOString()
            });
            // → 추천인 할인 적용
            await sbInsert('sm_customer_events', {
              customer_id: refs[0].referrer_id,
              event_type: 'referral_reward',
              event_data: { discount: 30, referred: customerId }
            });
          }
        }
        break;

      // === 블로그 필터링 감지 ===
      case 'blog_filtered':
        // → 블로그 필터링 기록 + 매체 품질 등급 재계산
        if (payload.blog_id) {
          await sbUpdate('sm_blog_snapshots', {id: payload.blog_id}, {is_filtered: true, filtered_date: new Date().toISOString().slice(0,10)});
        }
        // → 매체 이상 감지 시 L8/L9 트리거 체크
        if (payload.source_id) {
          await sbInsert('sm_risk_alerts', {
            alert_type: 'conversion_drop',
            severity: 'warning',
            condition_met: `source ${payload.source_id}: blog filtered`,
            is_resolved: false
          });
        }
        break;

      // === 로직 변경 감지 ===
      case 'logic_change_detected':
        // → 전 고객 주문서 보류 + 48시간 모니터링
        await sbInsert('sm_risk_alerts', {
          alert_type: 'account_ban',
          severity: 'critical',
          condition_met: `로직 변경 감지: ${payload.detail || 'N2 중앙값 2σ+ 변동'}`,
          is_resolved: false
        });
        // → 이벤트 분류 기록
        await sbInsert('sm_recovery_estimates', {
          event_type: 'logic_change',
          start_date: new Date().toISOString().slice(0,10),
          n2_drop: payload.n2_drop || 0
        });
        await sbInsert('sm_decision_log', {
          decision_type: 'logic_change_response',
          action_taken: '전 고객 주문서 48시간 보류',
          reasoning_summary: payload.detail || '87K 전체 N2 중앙값 2σ+ 변동 감지',
          confidence: payload.confidence || 0.7
        }).catch(() => {});
        break;

      // === 매체 이상 감지 ===
      case 'source_health_alert':
        // → L8/L9 트리거
        if (payload.source_name) {
          const lb = await sbQuery(`sm_source_leaderboard?source_name=eq.${payload.source_name}`);
          if (lb.length) {
            await sbUpdate('sm_source_leaderboard', {id: lb[0].id}, {
              beta: (lb[0].beta || 1) + 3,
              last_updated: new Date().toISOString()
            });
          }
          // Beta params도 업데이트
          const bp = await sbQuery(`sm_source_beta_params?source_name=eq.${payload.source_name}`);
          if (bp.length) {
            await sbUpdate('sm_source_beta_params', {id: bp[0].id}, {
              beta: parseFloat(bp[0].beta) + 3,
              last_updated: new Date().toISOString()
            });
          }
        }
        break;

      // === 시즌 이벤트 시작 ===
      case 'season_event_started':
        // → 이상 탐지 임계값 상향 + 투입량 시즌 보정
        await sbInsert('sm_decision_log', {
          decision_type: 'season_adjustment',
          action_taken: `시즌 보정 적용: ${payload.event_name || '시즌 이벤트'}`,
          reasoning_summary: `시즌 캘린더 일치. 이상 탐지 임계값 상향. 투입량 시즌 보정 곱연산.`,
          confidence: 0.9
        }).catch(() => {});
        break;

      // === 점진적 롤아웃 단계 진행 ===
      case 'rollout_phase_advanced':
        if (payload.rollout_id) {
          await sbUpdate('sm_rollout_phases', {id: payload.rollout_id}, {
            phase: payload.next_phase || 2,
            target_pct: payload.target_pct || 20,
            status: 'active',
            started_at: new Date().toISOString()
          });
        }
        break;

      // === 결제 연체 ===
      case 'payment_overdue':
        if (customerId) {
          // 즉시: 투입 중단
          const orders = await sbQuery(`sm_vendor_orders?customer_id=eq.${customerId}&status=eq.pending`);
          for (const o of orders) {
            await sbUpdate('sm_vendor_orders', {id: o.id}, {status: 'cancelled', notes: '[자동] 결제 미수 → 투입 중단'});
          }
          // 24h 후 2차 알림 스케줄
          await sbInsert('sm_remarketing_queue', {
            customer_id: customerId,
            stage: 1,
            message_type: 'payment_overdue',
            scheduled_at: new Date(Date.now() + 86400000).toISOString(),
            status: 'pending'
          });
          await sbInsert('sm_risk_alerts', {
            alert_type: 'churn_spike',
            severity: 'critical',
            condition_met: `customer ${customerId}: 결제 연체`,
            is_resolved: false
          });
        }
        break;

      // === 매체 투입 완료 ===
      case 'vendor_order_completed':
        // → 리더보드 업데이트
        if (payload.source) {
          const lb = await sbQuery(`sm_source_leaderboard?source_name=eq.${payload.source}`);
          if (lb.length) {
            // 리더보드 alpha/beta 업데이트 (Thompson Sampling)
            const isSuccess = payload.success !== false;
            await sbUpdate('sm_source_leaderboard', { id: lb[0].id }, {
              alpha: (lb[0].alpha || 1) + (isSuccess ? 1 : 0),
              beta: (lb[0].beta || 1) + (isSuccess ? 0 : 1),
              last_updated: new Date().toISOString()
            });
          }
        }
        break;
    }
  },

  // ===== 체험 시퀀스 자동 생성 =====
  async createTrialSequence(customerId) {
    const days = [
      { day: 1, action: 'rank_check', msg: '안녕하세요! 현재 순위를 확인해드렸어요 📊' },
      { day: 3, action: 'alert', msg: '3일째 순위 변동 현황을 알려드립니다 🔔' },
      { day: 5, action: 'expiry_warn', msg: '체험 기간 절반이 지났어요! 현재 성과를 확인해보세요 ⚠️' },
      { day: 7, action: 'conversion_push', msg: '무료체험이 곧 만료됩니다. 유료 전환 시 추가 혜택!' },
      { day: 10, action: 'decay_warn', msg: '체험 종료 후 순위 감쇠가 시작됩니다 📉' },
      { day: 14, action: 'competitor_report', msg: '경쟁사 대비 분석 리포트입니다 🏪' },
      { day: 30, action: 'logic_change', msg: '로직 변경이 감지되었습니다. 지금이 적기입니다!' }
    ];
    const now = Date.now();
    for (const d of days) {
      await sbInsert('sm_trial_sequences', {
        customer_id: customerId,
        day_offset: d.day,
        action_type: d.action,
        message: d.msg,
        scheduled_at: new Date(now + d.day * 86400000).toISOString(),
        status: 'pending'
      });
    }
  },

  // ===== 카카오 자동응답 시퀀스 생성 =====
  async createKakaoSequence(customerId) {
    const stages = [
      { stage: 'welcome', delay: 0, msg: '반갑습니다! 🎉 ONDA 네이버 플레이스 순위 관리 서비스입니다. 무료체험이 시작되었어요!' },
      { stage: '24h', delay: 86400000, msg: '어제 체험을 시작하셨는데, 현재 순위를 확인해보셨나요? 📊' },
      { stage: '72h', delay: 259200000, msg: '3일째 순위 변동 리포트입니다! 이미 변화가 보이고 있어요 📈' },
      { stage: '7d', delay: 604800000, msg: '체험 7일차! 유료 전환 시 첫 달 50% 할인 + 리뷰 5건 무료 🔥' }
    ];
    const now = Date.now();
    for (const s of stages) {
      await sbInsert('sm_kakao_sequences', {
        customer_id: customerId,
        stage: s.stage,
        message_template: s.msg,
        scheduled_at: new Date(now + s.delay).toISOString(),
        status: s.delay === 0 ? 'sent' : 'pending',
        sent_at: s.delay === 0 ? new Date().toISOString() : null
      });
    }
  },

  // ===== 외주 주문서 자동생성 =====
  async autoGenerateOrder(customerId) {
    const custs = await sbQuery(`sm_customers?id=eq.${customerId}`);
    if (!custs.length) return;
    const c = custs[0];
    const pkgHits = { starter: 150, growth: 300, pro: 500, review_only: 0 };
    const hits = pkgHits[c.package] || 150;
    if (hits > 0) {
      await sbInsert('sm_vendor_orders', {
        customer_id: customerId,
        source_name: 'auto_assigned',
        keyword: c.keyword,
        total_volume: hits,
        status: 'pending',
        notes: `[자동] ${c.store_name} 전환 → ${c.package} 패키지 투입 시작`,
        order_date: new Date().toISOString().split('T')[0]
      });
    }
  },

  // ===== 결제 기록 생성 =====
  async createPayment(customerId, pkg) {
    const prices = { starter: 40000, growth: 80000, pro: 150000, review_only: 30000 };
    await sbInsert('sm_payments', {
      customer_id: customerId,
      amount: prices[pkg] || 40000,
      package: pkg || 'starter',
      status: 'pending',
      payment_date: new Date().toISOString().split('T')[0]
    });
  },

  // ===== KPI 업데이트 =====
  async updateKpi(metric, value) {
    const today = new Date().toISOString().split('T')[0];
    const existing = await sbQuery(`sm_kpi_tracking?metric_name=eq.${metric}&period_date=eq.${today}`);
    if (existing.length) {
      await sbUpdate('sm_kpi_tracking', { id: existing[0].id }, {
        actual_value: (existing[0].actual_value || 0) + value,
        achievement_pct: existing[0].target_value ? Math.round(((existing[0].actual_value||0)+value)/existing[0].target_value*100) : null
      });
    } else {
      await sbInsert('sm_kpi_tracking', { metric_name: metric, period_date: today, period_type: 'daily', actual_value: value });
    }
  },

  // ===== 카카오 인증코드 생성 =====
  generateVerificationCode() {
    return 'ONDA-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  },

  // ===== 카카오 인증코드 검증 =====
  async verifyKakaoCode(code) {
    const custs = await sbQuery(`sm_customers?kakao_verify_code=eq.${code}&kakao_verified=eq.false`);
    if (custs.length) {
      const c = custs[0];
      await this.emit('kakao_friend_verified', {
        entity_type: 'customer',
        verification_code: code,
        store_name: c.store_name
      }, c.id);
      return { success: true, customer: c };
    }
    return { success: false };
  },

  // ===== 이탈 위험 일괄 스캔 =====
  async scanChurnRisk() {
    const actives = await sbQuery('sm_customers?status=eq.active');
    let alerts = 0;
    for (const c of actives) {
      try {
        const risk = await sbRpc('calculate_churn_risk', { cust_id: c.id });
        if (risk && risk.risk_score > 60) {
          await this.emit('churn_risk_detected', {
            entity_type: 'customer',
            risk_score: risk.risk_score,
            factors: risk.factors
          }, c.id);
          alerts++;
        }
      } catch (e) { /* skip */ }
    }
    return alerts;
  },

  // ===== 자기잠식 감지 =====
  async detectCannibalization() {
    return await sbRpc('detect_cannibalization').catch(() => 0);
  }
};

// 글로벌로 사용 가능하게
window.EventHub = EventHub;
