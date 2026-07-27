  // v7.74.59: remote visual locomotion controller.
  // Remote-player теперь отображается как обычный локальный персонаж с удалённым
  // управлением: серверная позиция хранится как невидимый якорь, а видимая модель
  // каждый кадр движется по intent/speed и мягко корректируется к якорю.
  const REMOTE_PLAYER_INTERP_DELAY_MS = 8;
  const REMOTE_PLAYER_MOBILE_INTERP_DELAY_MS = 7;
  const REMOTE_PLAYER_MAX_EXTRAPOLATE_MS = 10;
  const REMOTE_PLAYER_MAX_SAMPLE_AGE_MS = 950;
  const REMOTE_PLAYER_SNAP_DISTANCE = 5.8;
  const REMOTE_PLAYER_TELEPORT_SNAP_DISTANCE = 11.5;
  const REMOTE_PLAYER_DUPLICATE_EPS = 0.006;
  const REMOTE_PLAYER_IDLE_SNAP_DISTANCE = 0.085;
  const REMOTE_PLAYER_IDLE_ANGLE_EPS = 0.035;
  const REMOTE_PLAYER_MAX_VISUAL_SPEED = 12.0;
  const REMOTE_PLAYER_CATCHUP_VISUAL_SPEED = 17.5;
  const REMOTE_PLAYER_IDLE_VISUAL_SPEED = 18.0;
  const REMOTE_PLAYER_VELOCITY_LEAD_MS = 6;
  const REMOTE_PLAYER_MAX_VELOCITY = 7.2;
  const REMOTE_PLAYER_DEAD_RECKON_LEAD_MS = 0;
  const REMOTE_PLAYER_MAX_DEAD_RECKON_MS = 24;
  const REMOTE_PLAYER_BACKTRACK_EPS = 0.035;
  const REMOTE_PLAYER_MAX_LEAD_DISTANCE = 0.24;
  const REMOTE_PLAYER_FAR_DISTANCE = 13.5;
  const REMOTE_PLAYER_FAR_INTERP_DELAY_MS = 54;
  const REMOTE_PLAYER_FAR_MAX_EXTRAPOLATE_MS = 0;
  const REMOTE_PLAYER_FAR_VELOCITY_LEAD_MS = 0;
  const REMOTE_PLAYER_FAR_CATCHUP_SPEED = 9.5;
  const REMOTE_VISUAL_MIN_SPEED = 0.06;
  const REMOTE_VISUAL_MAX_PACKET_AGE_MS = 260;
  const REMOTE_VISUAL_PREDICT_MS = 78;
  const REMOTE_VISUAL_SIDE_CORRECTION = 18.0;
  const REMOTE_VISUAL_BEHIND_CORRECTION = 11.5;
  const REMOTE_VISUAL_AHEAD_SOFT_LIMIT = 0.28;
  const REMOTE_VISUAL_AHEAD_HARD_LIMIT = 0.56;
  const REMOTE_VISUAL_IDLE_CORRECTION = 22.0;
  const REMOTE_VISUAL_VELOCITY_BLEND = 0.34;
  const REMOTE_VISUAL_DIRECTION_BLEND = 0.42;
  const REMOTE_VISUAL_TURN_DIRECTION_BLEND = 0.82;
  const REMOTE_VISUAL_TURN_SIDE_CORRECTION = 7.5;
  const REMOTE_VISUAL_TURN_BEHIND_CORRECTION = 6.5;
  const REMOTE_VISUAL_TURN_PREDICT_MS = 24;
  const REMOTE_VISUAL_TURN_ANGLE_THRESHOLD = 0.20;
  const REMOTE_VISUAL_SHARP_TURN_THRESHOLD = 0.62;
  const REMOTE_VISUAL_CURVE_MODE_MS = 320;
  const REMOTE_VISUAL_CURVE_MIN_TURN = 0.085;
  const REMOTE_VISUAL_CURVE_PREDICT_MS = 10;
  const REMOTE_VISUAL_CURVE_FOLLOW_GAIN = 4.2;
  const REMOTE_VISUAL_CURVE_ALONG_GAIN = 1.15;
  const REMOTE_VISUAL_CURVE_SIDE_GAIN = 4.2;
  const REMOTE_VISUAL_CURVE_MAX_EXTRA_SPEED = 0.10;
  const REMOTE_VISUAL_CURVE_MAX_SPEED_FACTOR = 1.015;
  const REMOTE_VISUAL_CURVE_VELOCITY_RATE = 16;
  const REMOTE_VISUAL_CURVE_ROTATION_RATE = 32;
  // v7.74.64: at high desktop FPS small anchor corrections are visible as an
  // artificial speed-up on sharp turns. Clamp the whole per-frame visual
  // displacement after all steering/corrections, so remote players cannot move
  // faster than their real packet speed just because the renderer is smoother.
  const REMOTE_VISUAL_FRAME_SPEED_FACTOR = 1.015;
  const REMOTE_VISUAL_FRAME_EXTRA_SPEED = 0.18;
  const REMOTE_VISUAL_FRAME_TURN_EXTRA_SPEED = 0.08;
  // v7.74.65: turn/vector-change side dampers. During sharp direction changes
  // the server anchor can be laterally offset from the visual character; applying
  // that correction directly to position looks like the remote player slides
  // sideways. Keep a small dead zone and cap lateral correction as a velocity.
  const REMOTE_VISUAL_TURN_SIDE_DEADBAND = 0.24;
  const REMOTE_VISUAL_CURVE_SIDE_DEADBAND = 0.30;
  const REMOTE_VISUAL_TURN_SIDE_MAX_SPEED = 0.62;
  const REMOTE_VISUAL_CURVE_SIDE_MAX_SPEED = 0.48;
  const REMOTE_VISUAL_STRAIGHT_SIDE_MAX_SPEED = 2.6;
  // v7.74.73: stop-turn brake. When a remote player releases movement during
  // a turn, the final authoritative idle point can be ahead/sideways from the
  // visual arc. Correct to it with a capped brake instead of a one-frame lunge.
  const REMOTE_VISUAL_STOP_TURN_BRAKE_MS = 360;
  const REMOTE_VISUAL_STOP_TURN_MAX_SPEED = 3.25;
  const REMOTE_VISUAL_STOP_TURN_SNAP_DISTANCE = 0.028;
  const REMOTE_VISUAL_STOP_TURN_ROT_RATE = 18;
  // v7.74.73: after a turn-stop the authoritative idle point can be a little
  // sideways from the rendered arc. Do not visibly slide the model sideways right
  // after the stop; first brake along the last movement tangent, then settle the
  // lateral error slowly while the character is already idle.
  const REMOTE_VISUAL_STOP_TURN_SIDE_LOCK_MS = 520;
  const REMOTE_VISUAL_STOP_TURN_SIDE_SETTLE_MS = 900;
  const REMOTE_VISUAL_STOP_TURN_SIDE_DEADBAND = 0.20;
  const REMOTE_VISUAL_STOP_TURN_SIDE_SETTLE_SPEED = 0.42;
  // v7.74.74: once a remote player stops, freeze one visual idle anchor.
  // Idle packets can still differ by a few centimeters/angle ticks; following
  // every one of them makes the model twitch while standing.
  const REMOTE_VISUAL_IDLE_ANCHOR_LOCK_MS = 760;
  const REMOTE_VISUAL_IDLE_TURN_ANCHOR_LOCK_MS = 1280;
  const REMOTE_VISUAL_IDLE_ANCHOR_DEADBAND = 0.16;
  const REMOTE_VISUAL_IDLE_ANCHOR_HARD_UPDATE_DISTANCE = 0.62;
  const REMOTE_VISUAL_IDLE_ANCHOR_SETTLE_SPEED = 0.58;
  const REMOTE_VISUAL_IDLE_ANGLE_DEADBAND = 0.16;
  // v7.74.75: after a turn-stop, visual stability is more important than
  // correcting a few centimeters to the server idle point. Freeze the rendered
  // idle point and ignore tiny late authoritative idle packets; only a real
  // large correction/teleport may replace the anchor.
  const REMOTE_VISUAL_IDLE_FREEZE_HARD_UPDATE_DISTANCE = 1.25;
  const REMOTE_VISUAL_IDLE_FREEZE_ANGLE_UPDATE_MS = 180;

  function moveRemotePositionToward(group, targetX, targetZ, dt, options = {}) {
    if (!group || !group.position) return;
    const dx = Number(targetX || 0) - group.position.x;
    const dz = Number(targetZ || 0) - group.position.z;
    const dist = Math.hypot(dx, dz);
    if (!Number.isFinite(dist) || dist <= 0.0001) {
      group.position.x = Number(targetX || 0);
      group.position.z = Number(targetZ || 0);
      return;
    }
    const isIdle = !!options.idle;
    const isFar = !!options.far;
    const speed = isIdle
      ? REMOTE_PLAYER_IDLE_VISUAL_SPEED
      : (isFar ? REMOTE_PLAYER_FAR_CATCHUP_SPEED : (dist > 0.75 ? REMOTE_PLAYER_CATCHUP_VISUAL_SPEED : REMOTE_PLAYER_MAX_VISUAL_SPEED));
    const maxStep = Math.max(isFar ? 0.010 : 0.018, speed * Math.max(0.001, Math.min(0.05, dt || 0.016)));
    if (dist <= maxStep) {
      group.position.x = Number(targetX || 0);
      group.position.z = Number(targetZ || 0);
      return;
    }
    const k = maxStep / dist;
    group.position.x += dx * k;
    group.position.z += dz * k;
  }

  function remotePlayerDistanceToLocal(row) {
    try {
      if (!player || !row?.group?.position) return 0;
      return Math.hypot(Number(row.group.position.x || 0) - Number(player.x || 0), Number(row.group.position.z || 0) - Number(player.z || 0));
    } catch (_) { return 0; }
  }

  function isRemotePlayerFar(row) {
    return remotePlayerDistanceToLocal(row) >= REMOTE_PLAYER_FAR_DISTANCE;
  }

  function remotePlayerInterpDelayMs(row) {
    // v7.74.58: close players stay responsive. Far players use a small stable
    // interpolation window and no visual lead, because long-distance prediction
    // is where backwards/forwards jitter is most visible.
    if (isRemotePlayerFar(row)) return REMOTE_PLAYER_FAR_INTERP_DELAY_MS;
    const base = IS_MOBILE_DEVICE ? REMOTE_PLAYER_MOBILE_INTERP_DELAY_MS : REMOTE_PLAYER_INTERP_DELAY_MS;
    const interval = Number(row?.netIntervalAvg || 0);
    const jitter = Number(row?.netJitterAvg || 0);
    const jitterPad = Number.isFinite(jitter) ? Math.min(5, jitter * 0.18) : 0;
    const slowPad = Number.isFinite(interval) ? Math.max(0, interval - 30) * 0.05 : 0;
    return Math.max(2, Math.min(14, base + jitterPad + slowPad));
  }

  function clampRemoteVelocity(v) {
    const n = Number(v || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-REMOTE_PLAYER_MAX_VELOCITY, Math.min(REMOTE_PLAYER_MAX_VELOCITY, n));
  }

  function hasLocalMovementIntent() {
    try {
      const keyboard = !!(keys && (keys['KeyW'] || keys['ArrowUp'] || keys['KeyS'] || keys['ArrowDown'] || keys['KeyA'] || keys['ArrowLeft'] || keys['KeyD'] || keys['ArrowRight']));
      const mobileStick = !!(typeof virtualMove !== 'undefined' && virtualMove && virtualMove.active && Math.hypot(Number(virtualMove.forward || 0), Number(virtualMove.right || 0)) > 0.04);
      return keyboard || mobileStick;
    } catch (_) {
      return false;
    }
  }

  function smoothOutgoingVelocity(axis, rawValue, moving, justStarted, turning = false) {
    const key = axis === 'z' ? 'smoothedOutgoingVz' : 'smoothedOutgoingVx';
    const raw = moving ? clampRemoteVelocity(rawValue) : 0;
    if (!moving) {
      multiplayer[key] = 0;
      return 0;
    }
    const prev = Number.isFinite(Number(multiplayer[key])) ? Number(multiplayer[key]) : raw;
    // v7.74.61: during circular movement per-axis velocity smoothing lags behind
    // the real tangent. Remote clients then cut the curve and get corrected by
    // the server anchor, which looks like small teleports. While turning, send
    // the current tangent almost immediately; keep smoothing only for straight
    // long runs where it removes micro-noise.
    const blend = justStarted ? 1 : (turning ? 0.92 : 0.58);
    const out = clampRemoteVelocity(prev * (1 - blend) + raw * blend);
    multiplayer[key] = out;
    return out;
  }

  function remoteVelocityFromSampleDelta(a, b) {
    if (!a || !b) return { vx: 0, vz: 0 };
    const dt = Math.max(0.001, (Number(b.t || 0) - Number(a.t || 0)) / 1000);
    return {
      vx: clampRemoteVelocity((Number(b.x || 0) - Number(a.x || 0)) / dt),
      vz: clampRemoteVelocity((Number(b.z || 0) - Number(a.z || 0)) / dt)
    };
  }

  function normalizeAngleForInterpolation(angle, around) {
    let a = Number.isFinite(Number(angle)) ? Number(angle) : 0;
    const base = Number.isFinite(Number(around)) ? Number(around) : a;
    while (a - base > Math.PI) a -= Math.PI * 2;
    while (a - base < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function interpolateRemoteAngle(a, b, k) {
    const end = normalizeAngleForInterpolation(b, a);
    return a + (end - a) * k;
  }

  function pushRemotePlayerSample(row, data = {}, options = {}) {
    if (!row || !row.group) return;
    const x = Number(data.x);
    const z = Number(data.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const receivedAt = Number.isFinite(Number(options.receivedAt)) ? Number(options.receivedAt) : performance.now();
    const rawAngle = Number.isFinite(Number(data.angle)) ? Number(data.angle) : Number(row.group.userData.targetAngle || 0);
    const moving = typeof data.moving === 'undefined' ? true : !!data.moving;
    const rawVx = moving ? clampRemoteVelocity(data.vx) : 0;
    const rawVz = moving ? clampRemoteVelocity(data.vz) : 0;
    const samples = Array.isArray(row.samples) ? row.samples : [];
    const last = samples[samples.length - 1] || null;
    if (last) {
      const interval = receivedAt - Number(last.t || receivedAt);
      if (Number.isFinite(interval) && interval > 2 && interval < 260) {
        const prevAvg = Number.isFinite(Number(row.netIntervalAvg)) ? Number(row.netIntervalAvg) : interval;
        row.netIntervalAvg = prevAvg * 0.82 + interval * 0.18;
        const diff = Math.abs(interval - row.netIntervalAvg);
        const prevJitter = Number.isFinite(Number(row.netJitterAvg)) ? Number(row.netJitterAvg) : diff;
        row.netJitterAvg = prevJitter * 0.82 + diff * 0.18;
      }
    }
    const prevNetAngle = Number.isFinite(Number(row.netAngle)) ? Number(row.netAngle) : rawAngle;
    const angle = last ? normalizeAngleForInterpolation(rawAngle, last.angle) : rawAngle;
    const normalizedRawAroundPrev = normalizeAngleForInterpolation(rawAngle, prevNetAngle);
    const angleDeltaFromPrev = Math.abs(normalizedRawAroundPrev - prevNetAngle);
    const sampleJump = last ? Math.hypot(x - last.x, z - last.z) : Infinity;
    const displayJump = Math.hypot(x - Number(row.group.position?.x || 0), z - Number(row.group.position?.z || 0));
    const wasMovingBeforePacket = !!row.netMoving
      || !!row.remoteMoving
      || Number(row.intentSpeed || 0) > REMOTE_VISUAL_MIN_SPEED
      || Math.hypot(Number(row.visualVelX || 0), Number(row.visualVelZ || 0)) > 0.08;
    // v7.74.60: do not snap the visible model to the server anchor just because
    // a sharp turn created temporary visual/anchor drift. Snap only on explicit
    // teleports/respawns or truly huge packet jumps. Normal turning is handled by
    // the visual locomotion controller below.
    const forceSnap = options.forceSnap || !last || sampleJump > REMOTE_PLAYER_TELEPORT_SNAP_DISTANCE;
    const deltaVel = last ? remoteVelocityFromSampleDelta(last, { t: receivedAt, x, z }) : { vx: rawVx, vz: rawVz };
    const packetHasVelocity = Math.hypot(rawVx, rawVz) > 0.01;
    const targetVx = packetHasVelocity ? rawVx : deltaVel.vx;
    const targetVz = packetHasVelocity ? rawVz : deltaVel.vz;
    const prevVx = Number.isFinite(Number(row.netVelX)) ? Number(row.netVelX) : targetVx;
    const prevVz = Number.isFinite(Number(row.netVelZ)) ? Number(row.netVelZ) : targetVz;
    const prevSpeedForTurn = Math.hypot(prevVx, prevVz);
    const nextSpeedForTurn = Math.hypot(targetVx, targetVz);
    let velocityTurn = 0;
    if (prevSpeedForTurn > 0.04 && nextSpeedForTurn > 0.04) {
      const dot = Math.max(-1, Math.min(1, (prevVx * targetVx + prevVz * targetVz) / (prevSpeedForTurn * nextSpeedForTurn)));
      velocityTurn = Math.acos(dot);
    }
    const packetTurning = !!data.turning || angleDeltaFromPrev > REMOTE_VISUAL_TURN_ANGLE_THRESHOLD || velocityTurn > REMOTE_VISUAL_TURN_ANGLE_THRESHOLD;
    const packetSharpTurn = angleDeltaFromPrev > REMOTE_VISUAL_SHARP_TURN_THRESHOLD || velocityTurn > REMOTE_VISUAL_SHARP_TURN_THRESHOLD;
    const curveTurn = moving && packetTurning && !packetSharpTurn && (velocityTurn > REMOTE_VISUAL_CURVE_MIN_TURN || angleDeltaFromPrev > REMOTE_VISUAL_CURVE_MIN_TURN || !!data.turning);
    const recentTurnBeforeStop = receivedAt - Number(row.lastTurnAt || 0) < 260
      || receivedAt - Number(row.lastCurveAt || 0) < 260
      || !!row.remoteCurveActive
      || (Number(row.curveModeUntil || 0) && receivedAt <= Number(row.curveModeUntil || 0) + 90);
    const stoppingDuringTurn = !moving && wasMovingBeforePacket && (packetTurning || packetSharpTurn || recentTurnBeforeStop);
    if (curveTurn) {
      const recentCurve = receivedAt - Number(row.lastCurveAt || 0) < 180;
      row.curveTurnCount = recentCurve ? Math.min(10, Number(row.curveTurnCount || 0) + 1) : 1;
      row.lastCurveAt = receivedAt;
      if (row.curveTurnCount >= 2) row.curveModeUntil = receivedAt + REMOTE_VISUAL_CURVE_MODE_MS;
    } else if (!moving) {
      row.curveTurnCount = 0;
      row.curveModeUntil = 0;
    } else if (receivedAt - Number(row.lastCurveAt || 0) > 220) {
      row.curveTurnCount = Math.max(0, Number(row.curveTurnCount || 0) - 1);
    }
    const velBlend = moving ? (packetSharpTurn ? 0.78 : packetTurning ? 0.74 : 0.42) : 1;
    row.netVelX = moving ? clampRemoteVelocity(prevVx * (1 - velBlend) + targetVx * velBlend) : 0;
    row.netVelZ = moving ? clampRemoteVelocity(prevVz * (1 - velBlend) + targetVz * velBlend) : 0;

    const sampleObj = { t: receivedAt, x, z, angle, crouching: !!data.crouching, moving, turning: packetTurning, vx: row.netVelX, vz: row.netVelZ };

    // v7.74.59: network state updates the invisible server anchor. The visible
    // model is moved later in updateRemoteVisualLocomotion(), every render frame.
    // This avoids fighting the renderer by directly rewriting group.position on
    // every socket packet.
    row.netX = x;
    row.netZ = z;
    row.netAngle = rawAngle;
    row.netCrouching = !!data.crouching;
    row.netMoving = moving;
    row.netReceivedAt = receivedAt;
    row.visualAnchorT = receivedAt;
    row.remoteTurning = packetTurning;
    row.remoteSharpTurn = packetSharpTurn;
    row.lastTurnAt = packetTurning ? receivedAt : Number(row.lastTurnAt || 0);
    const packetSpeed = Math.hypot(row.netVelX, row.netVelZ);
    if (moving && packetSpeed > REMOTE_VISUAL_MIN_SPEED) {
      const nextIntentX = row.netVelX / packetSpeed;
      const nextIntentZ = row.netVelZ / packetSpeed;
      const prevIntentX = Number.isFinite(Number(row.intentX)) ? Number(row.intentX) : nextIntentX;
      const prevIntentZ = Number.isFinite(Number(row.intentZ)) ? Number(row.intentZ) : nextIntentZ;
      const dirBlend = packetSharpTurn ? 1 : (packetTurning ? REMOTE_VISUAL_TURN_DIRECTION_BLEND : REMOTE_VISUAL_DIRECTION_BLEND);
      let ix = prevIntentX * (1 - dirBlend) + nextIntentX * dirBlend;
      let iz = prevIntentZ * (1 - dirBlend) + nextIntentZ * dirBlend;
      const il = Math.hypot(ix, iz) || 1;
      row.intentX = ix / il;
      row.intentZ = iz / il;
      row.intentSpeed = Math.min(REMOTE_PLAYER_MAX_VELOCITY, Math.max(0, packetSpeed));
      if (packetSharpTurn) {
        // A sharp turn should change the visual velocity direction, not keep the
        // old velocity for several frames and then be corrected by a position snap.
        const desiredVx = row.intentX * row.intentSpeed;
        const desiredVz = row.intentZ * row.intentSpeed;
        row.visualVelX = Number.isFinite(Number(row.visualVelX)) ? row.visualVelX * 0.35 + desiredVx * 0.65 : desiredVx;
        row.visualVelZ = Number.isFinite(Number(row.visualVelZ)) ? row.visualVelZ * 0.35 + desiredVz * 0.65 : desiredVz;
      }
    } else {
      row.intentSpeed = 0;
      row.intentX = 0;
      row.intentZ = 0;
    }

    if (!moving && wasMovingBeforePacket) {
      // v7.74.73: stopping while turning is not a teleport. Kill remaining
      // prediction/curve velocity immediately and let the render loop brake to
      // the final idle point with a capped speed. This removes the single lunge
      // just before the remote character stops.
      const prevVisualVx = Number(row.visualVelX || 0);
      const prevVisualVz = Number(row.visualVelZ || 0);
      const prevIntentX = Number(row.intentX || 0);
      const prevIntentZ = Number(row.intentZ || 0);
      const visualLen = Math.hypot(prevVisualVx, prevVisualVz);
      const intentLen = Math.hypot(prevIntentX, prevIntentZ);
      const useVisualDir = visualLen > 0.04;
      const dirLen = useVisualDir ? visualLen : (intentLen || 1);
      const brakeDirX = useVisualDir ? prevVisualVx / dirLen : prevIntentX / dirLen;
      const brakeDirZ = useVisualDir ? prevVisualVz / dirLen : prevIntentZ / dirLen;
      row.visualVelX = 0;
      row.visualVelZ = 0;
      row.remoteCurveActive = false;
      row.curveModeUntil = 0;
      row.curveTurnCount = 0;
      row.remoteTurning = false;
      row.remoteSharpTurn = false;
      // v7.74.75: do not chase the authoritative idle coordinate during the
      // visible stop. The server coordinate can arrive slightly behind/sideways
      // from the rendered curve, and correcting to it after the player already
      // appears stopped creates the reported backward/side twitch. Freeze the
      // visual idle anchor at the current rendered position; server coordinates
      // remain authoritative internally and will be used on the next movement or
      // a real teleport/respawn.
      let idleAnchorX = Number(row.group?.position?.x ?? x);
      let idleAnchorZ = Number(row.group?.position?.z ?? z);
      const visibleGapToServer = Math.hypot(idleAnchorX - x, idleAnchorZ - z);
      const freezeIdle = visibleGapToServer < REMOTE_VISUAL_IDLE_FREEZE_HARD_UPDATE_DISTANCE;
      if (!freezeIdle) {
        idleAnchorX = x;
        idleAnchorZ = z;
      }
      row.stopTurnBrakeUntil = 0;
      row.stopTurnSideLockUntil = 0;
      row.stopTurnSideSettleUntil = 0;
      row.stopTurnBrakeX = x;
      row.stopTurnBrakeZ = z;
      row.stopTurnBrakeAngle = rawAngle;
      row.stopTurnBrakeStartX = idleAnchorX;
      row.stopTurnBrakeStartZ = idleAnchorZ;
      row.stopTurnBrakeDirX = Number.isFinite(brakeDirX) ? brakeDirX : 0;
      row.stopTurnBrakeDirZ = Number.isFinite(brakeDirZ) ? brakeDirZ : 1;
      seedRemoteIdleAnchor(row, idleAnchorX, idleAnchorZ, rawAngle, receivedAt, { turnStop: stoppingDuringTurn, freeze: freezeIdle });
    } else if (!moving) {
      maybeUpdateRemoteIdleAnchor(row, x, z, rawAngle, receivedAt);
    }

    if ((options.source || 'snapshot') === 'state') {
      // v7.74.56: быстрый поток движения хранит последнюю авторитетную точку
      // отдельно. Render использует dead-reckoning от последней точки и скорости,
      // поэтому длительный бег не превращается в догоняние старых сэмплов.
      row.latestStateSample = sampleObj;
    }

    if (forceSnap) {
      row.samples = [sampleObj];
      row.group.position.set(x, 0, z);
      row.group.rotation.y = angle + Math.PI;
    } else if (!moving) {
      // Финальный idle-сэмпл является якорем. Не держим хвост движущихся точек,
      // иначе при остановке модель продолжает экстраполироваться вперёд и потом
      // возвращается назад — это выглядит как подёргивание.
      row.samples = [{ ...sampleObj, moving: false, vx: 0, vz: 0 }];
      row.latestStateSample = { ...sampleObj, moving: false, vx: 0, vz: 0 };
      // v7.74.74: do not snap the visible model to every idle packet.
      // After a stop we hold a single visual idle anchor; tiny authoritative
      // packet differences should not make the standing model twitch.
      if (!hasRemoteIdleAnchor(row) && !stoppingDuringTurn && displayJump < REMOTE_PLAYER_IDLE_SNAP_DISTANCE) {
        row.group.position.set(x, 0, z);
      }
      const idleRot = angle + Math.PI;
      let rotDiff = idleRot - row.group.rotation.y;
      while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
      while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
      if (Math.abs(rotDiff) < REMOTE_PLAYER_IDLE_ANGLE_EPS) row.group.rotation.y = idleRot;
    } else if (last && sampleJump < REMOTE_PLAYER_DUPLICATE_EPS && Math.abs(normalizeAngleForInterpolation(angle, last.angle) - last.angle) < 0.01) {
      // Если игрок стоит, не плодим почти одинаковые точки: это убирает дрожание
      // от сетевых пакетов, которые отличаются только округлением/временем.
      last.t = receivedAt;
      last.x = x;
      last.z = z;
      last.angle = angle;
      last.crouching = !!data.crouching;
      last.moving = moving;
      last.turning = packetTurning;
      last.vx = row.netVelX;
      last.vz = row.netVelZ;
      row.samples = samples;
    } else {
      samples.push(sampleObj);
      while (samples.length > 12) samples.shift();
      const minT = receivedAt - REMOTE_PLAYER_MAX_SAMPLE_AGE_MS;
      while (samples.length > 3 && samples[0].t < minT) samples.shift();
      row.samples = samples;
    }

    row.group.userData.targetX = x;
    row.group.userData.targetZ = z;
    row.group.userData.targetAngle = rawAngle;
    row.group.userData.crouching = !!data.crouching;
    row.group.userData.remoteMoving = moving;
    row.group.userData.netVelX = row.netVelX;
    row.group.userData.netVelZ = row.netVelZ;
    row.remoteMoving = moving;
    if (moving) {
      row.stopTurnBrakeUntil = 0;
      row.stopTurnSideLockUntil = 0;
      row.stopTurnSideSettleUntil = 0;
      clearRemoteIdleAnchor(row);
    }
    row.lastNetworkAt = receivedAt;
    row.lastMotionSource = options.source || 'snapshot';
    row.lastMotionAt = receivedAt;
  }

  function sampleRemotePlayerDeadReckon(row, now = performance.now()) {
    const s = row?.latestStateSample;
    if (!s || s.moving === false) return null;
    // Far-range mode is intentionally conservative. At a distance even a small
    // prediction correction looks like the whole character snaps backwards.
    // Use buffered interpolation there instead of dead-reckoning.
    if (isRemotePlayerFar(row)) return null;
    const vx = clampRemoteVelocity(s.vx || row.netVelX);
    const vz = clampRemoteVelocity(s.vz || row.netVelZ);
    if (Math.hypot(vx, vz) < 0.03) return null;
    const ageMs = now - Number(s.t || now);
    if (!Number.isFinite(ageMs) || ageMs < -40 || ageMs > 220) return null;
    const predictMs = Math.min(REMOTE_PLAYER_MAX_DEAD_RECKON_MS, Math.max(0, ageMs + REMOTE_PLAYER_DEAD_RECKON_LEAD_MS));
    const predictSec = predictMs / 1000;
    return {
      ...s,
      x: Number(s.x || 0) + vx * predictSec,
      z: Number(s.z || 0) + vz * predictSec,
      vx,
      vz,
      moving: true
    };
  }

  function sampleRemotePlayer(row, now = performance.now()) {
    // v7.74.57: для частого playerState используем последнюю позицию + скорость,
    // а не старый сэмпл-буфер. Это убирает задержку и рывки при долгом движении.
    const realtime = sampleRemotePlayerDeadReckon(row, now);
    if (realtime) return realtime;
    const samples = Array.isArray(row?.samples) ? row.samples : [];
    if (!samples.length) return null;
    const farMode = isRemotePlayerFar(row);
    if (samples.length === 1) {
      const only = samples[0];
      if (only.moving === false) return only;
      const leadMs = farMode ? REMOTE_PLAYER_FAR_VELOCITY_LEAD_MS : REMOTE_PLAYER_VELOCITY_LEAD_MS;
      const lead = Math.min(leadMs, Math.max(0, now - Number(only.t || now))) / 1000;
      return { ...only, x: only.x + clampRemoteVelocity(only.vx || row.netVelX) * lead, z: only.z + clampRemoteVelocity(only.vz || row.netVelZ) * lead };
    }
    const renderAt = now - remotePlayerInterpDelayMs(row);
    while (samples.length > 2 && samples[1].t <= renderAt) samples.shift();
    const a = samples[0];
    const b = samples[1] || a;
    if (!a || !b) return samples[samples.length - 1] || null;
    if (renderAt <= a.t) return a;
    if (renderAt <= b.t) {
      const span = Math.max(1, b.t - a.t);
      const k = Math.max(0, Math.min(1, (renderAt - a.t) / span));
      const moving = b.moving !== false;
      const vx = moving ? clampRemoteVelocity(b.vx || row.netVelX) : 0;
      const vz = moving ? clampRemoteVelocity(b.vz || row.netVelZ) : 0;
      const lead = moving ? ((farMode ? REMOTE_PLAYER_FAR_VELOCITY_LEAD_MS : REMOTE_PLAYER_VELOCITY_LEAD_MS) / 1000) : 0;
      return {
        x: a.x + (b.x - a.x) * k + vx * lead,
        z: a.z + (b.z - a.z) * k + vz * lead,
        angle: interpolateRemoteAngle(a.angle, b.angle, k),
        crouching: b.crouching,
        moving,
        vx,
        vz
      };
    }
    if (b.moving === false) return b;
    if (farMode) return b;
    const extra = Math.min(farMode ? REMOTE_PLAYER_FAR_MAX_EXTRAPOLATE_MS : REMOTE_PLAYER_MAX_EXTRAPOLATE_MS, renderAt - b.t);
    const span = Math.max(1, b.t - a.t);
    const k = extra / span;
    const vx = clampRemoteVelocity(b.vx || row.netVelX || (b.x - a.x) / Math.max(0.001, (b.t - a.t) / 1000));
    const vz = clampRemoteVelocity(b.vz || row.netVelZ || (b.z - a.z) / Math.max(0.001, (b.t - a.t) / 1000));
    const extraSec = extra / 1000;
    const leadSec = (farMode ? REMOTE_PLAYER_FAR_VELOCITY_LEAD_MS : REMOTE_PLAYER_VELOCITY_LEAD_MS) / 1000;
    return {
      x: b.x + vx * (extraSec + leadSec),
      z: b.z + vz * (extraSec + leadSec),
      angle: interpolateRemoteAngle(a.angle, b.angle, Math.min(1.08, 1 + k)),
      crouching: b.crouching,
      moving: true,
      vx,
      vz
    };
  }

  function makeRemotePlayerModel(data = {}) {
    const g = new THREE.Group();
    const remoteCastShadow = !IS_MOBILE_DEVICE;
    const parts = {};
    buildModernWastelandHumanoid(g, parts, { castShadow: remoteCastShadow, isPlayer: false });
    buildModernCharacterArmorExtras(g, parts, remoteCastShadow);
    initWeaponVisualState(parts.weaponGroup);

    const nameSprite = makeRemoteNameSprite(data.name || 'Игрок', data.deviceType || 'desktop');
    g.add(nameSprite);

    g.userData.parts = parts;
    g.userData.nameSprite = nameSprite;
    g.userData.targetX = Number(data.x || 0);
    g.userData.targetZ = Number(data.z || 0);
    g.userData.targetAngle = Number(data.angle || 0);
    // v7.74.48: позиция модели хранится отдельно от сетевой цели.
    // Движение идёт по короткому сэмпл-буферу, а не резкими перезаписями group.position.
    g.userData.lastTargetX = g.userData.targetX;
    g.userData.lastTargetZ = g.userData.targetZ;
    g.userData.netVelX = 0;
    g.userData.netVelZ = 0;
    g.userData.visualVelX = 0;
    g.userData.visualVelZ = 0;
    g.userData.visualIntentX = 0;
    g.userData.visualIntentZ = 0;
    g.userData.visualSpeed = 0;
    g.userData.serverAnchorX = g.userData.targetX;
    g.userData.serverAnchorZ = g.userData.targetZ;
    g.userData.targetUpdatedAt = performance.now();
    g.position.set(g.userData.targetX, 0, g.userData.targetZ);
    g.rotation.y = g.userData.targetAngle + Math.PI;
    updateRemoteEquipmentVisuals(g, data);
    scene.add(g);
    return g;
  }

  function remoteEquipmentKey(data = {}) {
    const eq = data.equipment || {};
    return [data.weapon || eq.weapon || '', eq.weapon || '', eq.armor || '', eq.helmet || '', eq.boots || '', eq.backpack || ''].join('|');
  }

  function remoteNameKey(data = {}) {
    return `${data.name || 'Игрок'}|${data.deviceType || 'desktop'}`;
  }

  function upsertRemotePlayer(data, options = {}) {
    if (!data || !data.id) return;
    if (multiplayer.socket && data.id === multiplayer.socket.id) return;
    if (data.dead || Number(data.hp ?? 1) <= 0) {
      removeRemotePlayerFromNetworkEvent(data);
      return;
    }
    // Один персонаж не должен иметь две модели при смерти, респавне,
    // реконнекте или смене комнаты. socket.id может поменяться, characterId — нет.
    if (data.characterId) removeRemotePlayersByCharacterId(data.characterId, data.id);
    let row = multiplayer.remotePlayers.get(data.id);
    if (!row) {
      row = { data: {}, group: makeRemotePlayerModel(data), equipmentKey: '', nameKey: '', remoteContextBound: false };
      row.netX = Number(data.x || 0);
      row.netZ = Number(data.z || 0);
      row.visualX = row.netX;
      row.visualZ = row.netZ;
      row.intentX = 0;
      row.intentZ = 0;
      row.intentSpeed = 0;
      row.visualVelX = 0;
      row.visualVelZ = 0;
      multiplayer.remotePlayers.set(data.id, row);
      bindRemotePlayerContextOnce(row);
      addLog(`Игрок в локации: ${data.name || 'Игрок'}.`, null, 'system');
    } else {
      bindRemotePlayerContextOnce(row);
    }
    row.data = { ...row.data, ...data };
    const source = String(options.source || 'snapshot');
    const hasVisualProfile = source !== 'state' || !!data.equipment || !!data.weapon || !!data.injuries || !!data.level;
    if (hasVisualProfile) {
      const eqKey = remoteEquipmentKey(row.data);
      if (eqKey !== row.equipmentKey) {
        row.equipmentKey = eqKey;
        updateRemoteEquipmentVisuals(row.group, row.data);
      }
    }
    const nameKey = remoteNameKey(row.data);
    if (nameKey !== row.nameKey) {
      row.nameKey = nameKey;
      updateRemoteNameSprite(row.group.userData.nameSprite, row.data.name || 'Игрок', row.data.deviceType || 'desktop');
    }
    const nowMs = Number.isFinite(Number(options.receivedAt)) ? Number(options.receivedAt) : performance.now();
    const serverT = Number(options.serverT ?? options.snapshotT ?? data.t ?? 0);
    if (source === 'state') {
      const seq = Number(data.seq || 0);
      if (Number.isFinite(seq) && seq > 0) {
        const lastSeq = Number(row.lastPlayerStateSeq || 0);
        if (lastSeq && seq <= lastSeq) return;
        row.lastPlayerStateSeq = seq;
      }
      if (Number.isFinite(serverT) && serverT > 0) {
        const lastServerT = Number(row.lastPlayerStateServerT || 0);
        if (lastServerT && serverT < lastServerT) {
          // Старый playerState мог прийти после нового при сетевом джиттере.
          // Не добавляем такую точку в буфер, иначе при длинном движении модель
          // начинает откатываться назад/вперёд.
          return;
        }
        row.lastPlayerStateServerT = serverT;
      }
    }
    const recentRealtimeMotion = source === 'snapshot' && row.lastMotionSource === 'state' && nowMs - Number(row.lastMotionAt || 0) < 240;
    // Полный snapshot нужен для состава комнаты и статусов. Если уже идёт быстрый
    // поток playerState, snapshot не должен вторым потоком дёргать позицию модели.
    if (!recentRealtimeMotion) {
      pushRemotePlayerSample(row, data, {
        source,
        receivedAt: nowMs,
        forceSnap: String(data.reason || '') === 'respawn' || !!options.forceSnap
      });
    } else {
      row.group.userData.targetAngle = Number(data.angle ?? row.group.userData.targetAngle ?? 0);
      row.group.userData.crouching = !!row.data.crouching;
    }
    const nextX = Number(row.group.userData.targetX ?? data.x ?? row.group.position?.x ?? 0);
    const nextZ = Number(row.group.userData.targetZ ?? data.z ?? row.group.position?.z ?? 0);
    row.x = Number(row.group.position?.x ?? nextX);
    row.z = Number(row.group.position?.z ?? nextZ);
    const sameLocation = !!(currentLocation && (!data.locationId || data.locationId === currentLocation.id));
    if (!sameLocation) {
      setNetworkRevealVisibility(row.group, false);
    } else {
      applyNetworkFogVisibilityNow(row.group, row.group.userData.targetX, row.group.userData.targetZ, { crouching: !!row.data?.crouching || !!row.group.userData.crouching });
    }
  }

  function removeRemotePlayer(id) {
    const row = multiplayer.remotePlayers.get(id);
    if (!row) return;
    forgetNetworkRevealObject(row.group);
    try { if (row.group) scene.remove(row.group); } catch (_) {}
    try {
      row.group?.traverse(obj => {
        if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
        if (obj.material && obj.material.dispose) obj.material.dispose();
        if (obj.userData && obj.userData.texture && obj.userData.texture.dispose) obj.userData.texture.dispose();
        if (obj.userData) delete obj.userData.remotePlayerRow;
      });
    } catch (_) {}
    multiplayer.remotePlayers.delete(id);
  }

  function removeRemotePlayersByCharacterId(characterId, exceptId = '') {
    const cid = String(characterId || '');
    if (!cid) return;
    [...multiplayer.remotePlayers.entries()].forEach(([id, row]) => {
      if (exceptId && id === exceptId) return;
      const rowCid = String(row?.data?.characterId || '');
      if (rowCid && rowCid === cid) removeRemotePlayer(id);
    });
  }

  function removeRemotePlayerFromNetworkEvent(data = {}) {
    const id = String(data?.id || data?.playerId || '');
    const characterId = String(data?.characterId || '');
    if (id) removeRemotePlayer(id);
    if (characterId) removeRemotePlayersByCharacterId(characterId, id);
  }

  function clearRemotePlayers() {
    [...multiplayer.remotePlayers.keys()].forEach(removeRemotePlayer);
  }

  const NETWORK_REVEAL_DURATION = 0.42;
  const NETWORK_REVEAL_MIN_ALPHA = 0.08;
  const networkRevealObjects = new Set();

  function clampReveal01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function revealSmoothStep(t) {
    t = clampReveal01(t);
    return t * t * (3 - 2 * t);
  }

  function ensureNetworkRevealMaterial(mat) {
    if (!mat || typeof mat.opacity !== 'number') return mat;
    if (mat.userData && mat.userData.networkRevealManaged) return mat;
    const managed = typeof mat.clone === 'function' ? mat.clone() : mat;
    if (!managed.userData) managed.userData = {};
    managed.userData.networkRevealManaged = true;
    managed.userData.networkRevealBaseOpacity = Number.isFinite(Number(managed.opacity)) ? Number(managed.opacity) : 1;
    managed.userData.networkRevealBaseTransparent = !!managed.transparent;
    managed.userData.networkRevealBaseDepthWrite = managed.depthWrite !== false;
    return managed;
  }

  function applyNetworkRevealAlpha(obj3d, alpha = 1) {
    if (!obj3d || typeof obj3d.traverse !== 'function') return;
    const a = clampReveal01(alpha);
    obj3d.traverse(child => {
      if (!child || !child.material) return;
      const wasArray = Array.isArray(child.material);
      const source = wasArray ? child.material : [child.material];
      let changed = false;
      const materials = source.map(mat => {
        const next = ensureNetworkRevealMaterial(mat);
        if (next !== mat) changed = true;
        return next;
      });
      if (changed) child.material = wasArray ? materials : materials[0];
      materials.forEach(mat => {
        if (!mat || typeof mat.opacity !== 'number' || !mat.userData) return;
        const baseOpacity = Number.isFinite(Number(mat.userData.networkRevealBaseOpacity))
          ? Number(mat.userData.networkRevealBaseOpacity)
          : 1;
        const baseTransparent = !!mat.userData.networkRevealBaseTransparent;
        const baseDepthWrite = mat.userData.networkRevealBaseDepthWrite !== false;
        mat.opacity = baseOpacity * a;
        mat.transparent = baseTransparent || a < 0.999;
        mat.depthWrite = a >= 0.999 ? baseDepthWrite : false;
        mat.needsUpdate = true;
      });
    });
  }

  function setNetworkRevealVisibility(obj3d, visible, options = {}) {
    if (!obj3d) return !!visible;
    const shouldShow = !!visible;
    const ud = obj3d.userData || (obj3d.userData = {});
    const wasShown = ud.networkRevealFogVisible === true;
    ud.networkRevealFogVisible = shouldShow;
    ud.rtsFogVisible = shouldShow;
    if (!shouldShow) {
      obj3d.visible = false;
      ud.networkRevealProgress = 0;
      ud.networkRevealActive = false;
      networkRevealObjects.delete(obj3d);
      return false;
    }

    obj3d.visible = true;
    if (options.instant) {
      ud.networkRevealProgress = 1;
      ud.networkRevealActive = false;
      networkRevealObjects.delete(obj3d);
      applyNetworkRevealAlpha(obj3d, 1);
      return true;
    }

    if (!wasShown) {
      ud.networkRevealProgress = 0;
      ud.networkRevealActive = true;
      networkRevealObjects.add(obj3d);
      applyNetworkRevealAlpha(obj3d, NETWORK_REVEAL_MIN_ALPHA);
      return true;
    }

    if (ud.networkRevealActive) networkRevealObjects.add(obj3d);
    return true;
  }

  function forgetNetworkRevealObject(obj3d) {
    if (!obj3d) return;
    networkRevealObjects.delete(obj3d);
    if (obj3d.userData) {
      obj3d.userData.networkRevealActive = false;
      obj3d.userData.networkRevealFogVisible = false;
    }
  }

  function updateNetworkRevealTransitions(dt = 0.016) {
    if (!networkRevealObjects.size) return;
    const step = Math.max(0.001, Math.min(0.08, Number(dt || 0.016))) / NETWORK_REVEAL_DURATION;
    networkRevealObjects.forEach(obj3d => {
      const ud = obj3d?.userData;
      if (!obj3d || !ud || !ud.networkRevealActive || ud.networkRevealFogVisible !== true) {
        networkRevealObjects.delete(obj3d);
        return;
      }
      ud.networkRevealProgress = Math.min(1, Number(ud.networkRevealProgress || 0) + step);
      const alpha = NETWORK_REVEAL_MIN_ALPHA + (1 - NETWORK_REVEAL_MIN_ALPHA) * revealSmoothStep(ud.networkRevealProgress);
      obj3d.visible = true;
      applyNetworkRevealAlpha(obj3d, alpha);
      if (ud.networkRevealProgress >= 1) {
        ud.networkRevealActive = false;
        applyNetworkRevealAlpha(obj3d, 1);
        networkRevealObjects.delete(obj3d);
      }
    });
  }

  // v7.74.35: сетевые сущности не должны даже на один кадр проскакивать
  // сквозь туман войны. Раньше socket-снимки ставили visible=true, а общий
  // fog-pass скрывал игроков/мобов только следующим циклом. Из-за этого
  // удалённый игрок мигал в скрытой зоне, а после "Забрать всё" на секунду
  // появлялись все NPC/мобы. Теперь любая сетевая вставка/обновление сразу
  // проходит через тот же строгий fog-of-war, что и render tick.
  function applyNetworkFogVisibilityNow(obj3d, worldX, worldZ, options = {}) {
    if (!obj3d) return true;
    let visible = true;
    try {
      if (typeof isWorldPointVisibleByRtsFog === 'function') {
        visible = !!isWorldPointVisibleByRtsFog(Number(worldX || 0), Number(worldZ || 0), options);
      }
    } catch (_) {
      visible = true;
    }
    setNetworkRevealVisibility(obj3d, visible, options);
    return visible;
  }

  function refreshNetworkFogVisibilityNow() {
    try {
      enemies.forEach(enemy => {
        if (!enemy || !enemy.mesh || enemy._removed) return;
        applyNetworkFogVisibilityNow(enemy.mesh, enemy.x, enemy.z);
      });
      multiplayer.remotePlayers.forEach(row => {
        if (!row || !row.group) return;
        const x = Number(row.group.position?.x ?? row.x ?? row.data?.x ?? 0);
        const z = Number(row.group.position?.z ?? row.z ?? row.data?.z ?? 0);
        applyNetworkFogVisibilityNow(row.group, x, z, { crouching: !!row.data?.crouching || !!row.group.userData.crouching });
      });
      multiplayer.groundItems.forEach(row => {
        if (!row || !row.mesh) return;
        applyNetworkFogVisibilityNow(row.mesh, Number(row.x || 0), Number(row.z || 0));
      });
      multiplayer.worldContainers.forEach(row => {
        if (!row || !row.mesh) return;
        applyNetworkFogVisibilityNow(row.mesh, Number(row.x || 0), Number(row.z || 0));
      });
      resourceNodes.forEach(node => {
        if (!node || !node.mesh) return;
        const pos = tileToWorld(node.tx, node.tz);
        applyNetworkFogVisibilityNow(node.mesh, pos.x, pos.z);
      });
    } catch (_) {}
  }

  function remotePlayerAntiRollbackTarget(row, sample, group) {
    if (!row || !sample || !group || sample.moving === false) return sample;
    if (isRemotePlayerFar(row)) return sample;
    const vx = clampRemoteVelocity(sample.vx || row.netVelX);
    const vz = clampRemoteVelocity(sample.vz || row.netVelZ);
    const speed = Math.hypot(vx, vz);
    if (!Number.isFinite(speed) || speed < 0.08) return sample;
    const dirX = vx / speed;
    const dirZ = vz / speed;
    const visualX = Number(group.position?.x || 0);
    const visualZ = Number(group.position?.z || 0);
    let sx = Number(sample.x || 0);
    let sz = Number(sample.z || 0);
    const ex = sx - visualX;
    const ez = sz - visualZ;
    const along = ex * dirX + ez * dirZ;

    // If prediction placed the visual model slightly ahead, do not let the next
    // network packet pull it backwards along the movement direction. Correct only
    // sideways error. Large backwards gaps are still allowed to resolve naturally
    // through normal movement/snap logic because they usually mean collision,
    // direction change, teleport or respawn.
    if (along < -REMOTE_PLAYER_BACKTRACK_EPS && Math.abs(along) < REMOTE_PLAYER_MAX_LEAD_DISTANCE) {
      const perpX = ex - along * dirX;
      const perpZ = ez - along * dirZ;
      sx = visualX + perpX;
      sz = visualZ + perpZ;
      return { ...sample, x: sx, z: sz };
    }
    return sample;
  }

  function remoteAngleBlend(current, target, dt, idle = false) {
    let diff = target - current;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const base = idle ? 26 : 32;
    const minK = idle ? 0.18 : 0.20;
    const k = Math.min(1, Math.max(minK, 1 - Math.exp(-base * Math.max(0.001, dt || 0.016))));
    return current + diff * k;
  }

  function softFactor(rate, dt) {
    return Math.min(1, 1 - Math.exp(-Math.max(0, rate) * Math.max(0.001, Math.min(0.05, dt || 0.016))));
  }

  function normalizedStopTurnDirection(row, fallbackAngle = 0) {
    let dx = Number(row?.stopTurnBrakeDirX || 0);
    let dz = Number(row?.stopTurnBrakeDirZ || 0);
    let len = Math.hypot(dx, dz);
    if (!Number.isFinite(len) || len < 0.02) {
      dx = Number(row?.intentX || 0);
      dz = Number(row?.intentZ || 0);
      len = Math.hypot(dx, dz);
    }
    if (!Number.isFinite(len) || len < 0.02) {
      dx = Math.sin(Number(fallbackAngle || 0));
      dz = Math.cos(Number(fallbackAngle || 0));
      len = Math.hypot(dx, dz);
    }
    if (!Number.isFinite(len) || len < 0.02) return { x: 0, z: 1 };
    return { x: dx / len, z: dz / len };
  }

  function stopTurnLockedTarget(row, netX, netZ, now = performance.now()) {
    const sx = Number.isFinite(Number(row?.stopTurnBrakeStartX)) ? Number(row.stopTurnBrakeStartX) : Number(row?.group?.position?.x || netX || 0);
    const sz = Number.isFinite(Number(row?.stopTurnBrakeStartZ)) ? Number(row.stopTurnBrakeStartZ) : Number(row?.group?.position?.z || netZ || 0);
    const dir = normalizedStopTurnDirection(row, row?.netAngle || row?.group?.userData?.targetAngle || 0);
    const toNetX = Number(netX || 0) - sx;
    const toNetZ = Number(netZ || 0) - sz;
    const along = toNetX * dir.x + toNetZ * dir.z;
    const alongX = sx + dir.x * along;
    const alongZ = sz + dir.z * along;
    const sideX = Number(netX || 0) - alongX;
    const sideZ = Number(netZ || 0) - alongZ;
    const sideDist = Math.hypot(sideX, sideZ);
    const lockUntil = Number(row?.stopTurnSideLockUntil || 0);
    const settleUntil = Number(row?.stopTurnSideSettleUntil || 0);
    if (now <= lockUntil || sideDist <= REMOTE_VISUAL_STOP_TURN_SIDE_DEADBAND) {
      return { x: alongX, z: alongZ, locked: true, sideX, sideZ, sideDist };
    }
    if (now <= settleUntil && sideDist > 0.0001) {
      const phase = 1 - Math.max(0, Math.min(1, (settleUntil - now) / Math.max(1, REMOTE_VISUAL_STOP_TURN_SIDE_SETTLE_MS)));
      const k = Math.max(0, Math.min(1, phase * 0.38));
      return { x: alongX + sideX * k, z: alongZ + sideZ * k, locked: false, settling: true, sideX, sideZ, sideDist };
    }
    return { x: Number(netX || 0), z: Number(netZ || 0), locked: false, sideX, sideZ, sideDist };
  }

  function hasRemoteIdleAnchor(row) {
    return !!row && Number.isFinite(Number(row.idleVisualAnchorX)) && Number.isFinite(Number(row.idleVisualAnchorZ));
  }

  function getRemoteIdleAnchor(row, fallbackX, fallbackZ) {
    if (hasRemoteIdleAnchor(row)) {
      return { x: Number(row.idleVisualAnchorX), z: Number(row.idleVisualAnchorZ) };
    }
    return { x: Number(fallbackX || 0), z: Number(fallbackZ || 0) };
  }

  function seedRemoteIdleAnchor(row, targetX, targetZ, angle, now, options = {}) {
    if (!row) return;
    row.idleVisualAnchorX = Number(targetX || 0);
    row.idleVisualAnchorZ = Number(targetZ || 0);
    row.idleVisualAngle = Number.isFinite(Number(angle)) ? Number(angle) : Number(row.netAngle || 0);
    const lockMs = options.turnStop ? REMOTE_VISUAL_IDLE_TURN_ANCHOR_LOCK_MS : REMOTE_VISUAL_IDLE_ANCHOR_LOCK_MS;
    row.idleVisualAnchorLockUntil = Number(now || performance.now()) + lockMs;
    row.idleVisualFrozen = !!options.freeze;
    row.idleVisualFrozenAt = row.idleVisualFrozen ? Number(now || performance.now()) : 0;
  }

  function maybeUpdateRemoteIdleAnchor(row, targetX, targetZ, angle, now) {
    if (!row) return;
    const tx = Number(targetX || 0);
    const tz = Number(targetZ || 0);
    if (!hasRemoteIdleAnchor(row)) {
      seedRemoteIdleAnchor(row, tx, tz, angle, now, { turnStop: false });
      return;
    }
    const ax = Number(row.idleVisualAnchorX);
    const az = Number(row.idleVisualAnchorZ);
    const dist = Math.hypot(tx - ax, tz - az);
    const lockActive = Number(now || performance.now()) < Number(row.idleVisualAnchorLockUntil || 0);
    if (row.idleVisualFrozen) {
      // v7.74.75: late idle packets after a turn-stop often differ by only a few
      // centimeters from the visual endpoint. Following them is exactly the
      // visible backward/side twitch reported in testing. Keep the visual idle
      // point frozen unless the authoritative position is far enough to be a
      // real correction, not network rounding.
      if (dist > REMOTE_VISUAL_IDLE_FREEZE_HARD_UPDATE_DISTANCE) {
        seedRemoteIdleAnchor(row, tx, tz, angle, now, { turnStop: false, freeze: false });
      } else if (Number.isFinite(Number(angle))) {
        const age = Number(now || performance.now()) - Number(row.idleVisualFrozenAt || 0);
        const prev = Number.isFinite(Number(row.idleVisualAngle)) ? Number(row.idleVisualAngle) : Number(angle);
        const a = normalizeAngleForInterpolation(Number(angle), prev);
        if (age > REMOTE_VISUAL_IDLE_FREEZE_ANGLE_UPDATE_MS && Math.abs(a - prev) > REMOTE_VISUAL_IDLE_ANGLE_DEADBAND) row.idleVisualAngle = a;
      }
      return;
    }
    if (dist > REMOTE_VISUAL_IDLE_ANCHOR_HARD_UPDATE_DISTANCE) {
      seedRemoteIdleAnchor(row, tx, tz, angle, now, { turnStop: false });
      return;
    }
    if (!lockActive && dist > REMOTE_VISUAL_IDLE_ANCHOR_DEADBAND) {
      // Authoritative idle correction after the visual stop lock expired. Update
      // the anchor slowly so it does not look like a standing twitch.
      const k = 0.10;
      row.idleVisualAnchorX = ax + (tx - ax) * k;
      row.idleVisualAnchorZ = az + (tz - az) * k;
    }
    if (Number.isFinite(Number(angle))) {
      const prev = Number.isFinite(Number(row.idleVisualAngle)) ? Number(row.idleVisualAngle) : Number(angle);
      const a = normalizeAngleForInterpolation(Number(angle), prev);
      if (!lockActive && Math.abs(a - prev) > REMOTE_VISUAL_IDLE_ANGLE_DEADBAND) row.idleVisualAngle = a;
    }
  }

  function clearRemoteIdleAnchor(row) {
    if (!row) return;
    row.idleVisualAnchorX = undefined;
    row.idleVisualAnchorZ = undefined;
    row.idleVisualAngle = undefined;
    row.idleVisualAnchorLockUntil = 0;
    row.idleVisualFrozen = false;
    row.idleVisualFrozenAt = 0;
  }

  function clampRemoteVisualFrameMotion(group, startX, startZ, targetSpeed, dt, options = {}) {
    if (!group || !group.position) return;
    const sx = Number(startX || 0);
    const sz = Number(startZ || 0);
    const dx = Number(group.position.x || 0) - sx;
    const dz = Number(group.position.z || 0) - sz;
    const dist = Math.hypot(dx, dz);
    if (!Number.isFinite(dist) || dist <= 0.0001) return;
    const baseSpeed = Math.max(0, Math.min(REMOTE_PLAYER_MAX_VELOCITY, Number(targetSpeed || 0)));
    const extra = Number.isFinite(Number(options.extraSpeed))
      ? Math.max(0, Number(options.extraSpeed))
      : (options.turning ? REMOTE_VISUAL_FRAME_TURN_EXTRA_SPEED : REMOTE_VISUAL_FRAME_EXTRA_SPEED);
    const maxStep = Math.max(0.002, (baseSpeed * REMOTE_VISUAL_FRAME_SPEED_FACTOR + extra) * Math.max(0.001, Math.min(0.05, dt || 0.016)));
    if (dist <= maxStep) return;
    const k = maxStep / dist;
    group.position.x = sx + dx * k;
    group.position.z = sz + dz * k;
  }

  function applyRemoteLateralCorrection(group, sideX, sideZ, dt, options = {}) {
    if (!group || !group.position) return;
    const sx = Number(sideX || 0);
    const sz = Number(sideZ || 0);
    const sideDist = Math.hypot(sx, sz);
    if (!Number.isFinite(sideDist) || sideDist <= 0.0001) return;
    const isCurve = !!options.curve;
    const isTurning = !!options.turning || isCurve;

    if (isTurning) {
      const deadband = isCurve ? REMOTE_VISUAL_CURVE_SIDE_DEADBAND : REMOTE_VISUAL_TURN_SIDE_DEADBAND;
      if (sideDist <= deadband) return;
      const maxSpeed = isCurve ? REMOTE_VISUAL_CURVE_SIDE_MAX_SPEED : REMOTE_VISUAL_TURN_SIDE_MAX_SPEED;
      const maxStep = Math.max(0.001, maxSpeed * Math.max(0.001, Math.min(0.05, dt || 0.016)));
      const step = Math.min(sideDist - deadband, maxStep);
      group.position.x += sx / sideDist * step;
      group.position.z += sz / sideDist * step;
      return;
    }

    const k = softFactor(REMOTE_VISUAL_SIDE_CORRECTION, dt);
    const rawStep = sideDist * k;
    const maxStep = Math.max(0.002, REMOTE_VISUAL_STRAIGHT_SIDE_MAX_SPEED * Math.max(0.001, Math.min(0.05, dt || 0.016)));
    const step = Math.min(rawStep, maxStep);
    group.position.x += sx / sideDist * step;
    group.position.z += sz / sideDist * step;
  }

  function updateRemoteVisualCurveMotion(row, dt, now, context = {}) {
    const g = row?.group;
    if (!g || !g.position) return false;
    const x0 = Number(g.position.x || 0);
    const z0 = Number(g.position.z || 0);
    const netX = Number(context.netX ?? row.netX ?? x0);
    const netZ = Number(context.netZ ?? row.netZ ?? z0);
    const netAngle = Number(context.netAngle ?? row.netAngle ?? 0);
    const dirX = Number(context.dirX || 0);
    const dirZ = Number(context.dirZ || 0);
    const targetSpeed = Math.max(0, Math.min(REMOTE_PLAYER_MAX_VELOCITY, Number(context.targetSpeed || row.intentSpeed || 0)));
    if (targetSpeed <= REMOTE_VISUAL_MIN_SPEED) return false;

    const desiredBaseVx = dirX * targetSpeed;
    const desiredBaseVz = dirZ * targetSpeed;
    const packetAgeMs = Math.max(0, Math.min(REMOTE_VISUAL_MAX_PACKET_AGE_MS, now - Number(row.netReceivedAt || now)));
    const leadSec = Math.min(REMOTE_VISUAL_CURVE_PREDICT_MS, packetAgeMs) / 1000;
    const anchorX = netX + desiredBaseVx * leadSec;
    const anchorZ = netZ + desiredBaseVz * leadSec;
    const errX = anchorX - x0;
    const errZ = anchorZ - z0;
    const gap = Math.hypot(errX, errZ);

    if (gap > REMOTE_PLAYER_TELEPORT_SNAP_DISTANCE) {
      g.position.set(netX, 0, netZ);
      row.visualVelX = 0;
      row.visualVelZ = 0;
      return true;
    }

    // v7.74.64: curve steering must not increase the visible run speed.
    // Previous curve mode added anchor correction to base velocity; at a large
    // turn angle this became a forward boost. Keep correction mostly lateral,
    // cap velocity close to the packet speed and finally clamp total frame travel.
    const baseLen = Math.hypot(dirX, dirZ) || 1;
    const tx = dirX / baseLen;
    const tz = dirZ / baseLen;
    const alongErr = errX * tx + errZ * tz;
    const sideErrX = errX - alongErr * tx;
    const sideErrZ = errZ - alongErr * tz;
    const sideErr = Math.hypot(sideErrX, sideErrZ);
    const sideNx = sideErr > 0.0001 ? sideErrX / sideErr : 0;
    const sideNz = sideErr > 0.0001 ? sideErrZ / sideErr : 0;
    const alongCorrection = alongErr > 0 ? Math.min(alongErr * REMOTE_VISUAL_CURVE_ALONG_GAIN, REMOTE_VISUAL_CURVE_MAX_EXTRA_SPEED) : 0;
    // v7.74.65: do not bake lateral anchor correction into the run velocity
    // during curve turns. That was the visible sideways offset on vector changes.
    // The lateral drift is corrected below by applyRemoteLateralCorrection(),
    // capped as a small side speed instead of a position shove.
    let desiredVx = tx * (targetSpeed + alongCorrection);
    let desiredVz = tz * (targetSpeed + alongCorrection);
    let desiredLen = Math.hypot(desiredVx, desiredVz);
    const maxCurveSpeed = Math.max(targetSpeed + REMOTE_VISUAL_CURVE_MAX_EXTRA_SPEED, targetSpeed * REMOTE_VISUAL_CURVE_MAX_SPEED_FACTOR);
    if (desiredLen > maxCurveSpeed && desiredLen > 0.0001) {
      desiredVx = desiredVx / desiredLen * maxCurveSpeed;
      desiredVz = desiredVz / desiredLen * maxCurveSpeed;
      desiredLen = maxCurveSpeed;
    }

    const prevVx = Number.isFinite(Number(row.visualVelX)) ? Number(row.visualVelX) : desiredBaseVx;
    const prevVz = Number.isFinite(Number(row.visualVelZ)) ? Number(row.visualVelZ) : desiredBaseVz;
    const vk = softFactor(REMOTE_VISUAL_CURVE_VELOCITY_RATE, dt);
    let vx = prevVx + (desiredVx - prevVx) * vk;
    let vz = prevVz + (desiredVz - prevVz) * vk;
    const outLen = Math.hypot(vx, vz);
    if (outLen > maxCurveSpeed && outLen > 0.0001) {
      vx = vx / outLen * maxCurveSpeed;
      vz = vz / outLen * maxCurveSpeed;
    }
    row.visualVelX = vx;
    row.visualVelZ = vz;
    g.position.x += vx * dt;
    g.position.z += vz * dt;

    const curvePostErrX = anchorX - g.position.x;
    const curvePostErrZ = anchorZ - g.position.z;
    const curvePostAlong = curvePostErrX * tx + curvePostErrZ * tz;
    applyRemoteLateralCorrection(
      g,
      curvePostErrX - curvePostAlong * tx,
      curvePostErrZ - curvePostAlong * tz,
      dt,
      { curve: true }
    );

    // If the arc follower somehow falls several tiles away, correct at a fixed
    // visual speed instead of a frame-snap. This is deliberately slower during
    // curve mode because a hard correction is exactly what looks like teleporting.
    const postGap = Math.hypot(anchorX - g.position.x, anchorZ - g.position.z);
    if (postGap > REMOTE_PLAYER_SNAP_DISTANCE) {
      moveRemotePositionToward(g, anchorX, anchorZ, dt, { far: false });
    }
    clampRemoteVisualFrameMotion(g, x0, z0, targetSpeed, dt, { turning: true, extraSpeed: REMOTE_VISUAL_FRAME_TURN_EXTRA_SPEED });

    const targetRot = netAngle + Math.PI;
    let diff = targetRot - g.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const rk = softFactor(REMOTE_VISUAL_CURVE_ROTATION_RATE, dt);
    g.rotation.y += diff * rk;
    g.userData.crouching = !!row.netCrouching;
    g.userData.remoteMoving = true;
    row.remoteCurveActive = true;
    return true;
  }

  function updateRemoteVisualLocomotion(row, dt, now = performance.now()) {
    const g = row?.group;
    if (!g || !g.position) return;
    const x0 = Number(g.position.x || 0);
    const z0 = Number(g.position.z || 0);
    const netX = Number.isFinite(Number(row.netX)) ? Number(row.netX) : Number(g.userData.targetX || x0);
    const netZ = Number.isFinite(Number(row.netZ)) ? Number(row.netZ) : Number(g.userData.targetZ || z0);
    const netAngle = Number.isFinite(Number(row.netAngle)) ? Number(row.netAngle) : Number(g.userData.targetAngle || 0);
    const moving = !!row.netMoving && Number(row.intentSpeed || 0) > REMOTE_VISUAL_MIN_SPEED;
    const packetAgeMs = Math.max(0, Math.min(REMOTE_VISUAL_MAX_PACKET_AGE_MS, now - Number(row.netReceivedAt || now)));
    const turnAgeMs = now - Number(row.lastTurnAt || 0);
    const turning = !!row.remoteTurning || (Number.isFinite(turnAgeMs) && turnAgeMs >= 0 && turnAgeMs < 180);
    const sharpTurn = !!row.remoteSharpTurn && Number.isFinite(turnAgeMs) && turnAgeMs >= 0 && turnAgeMs < 150;

    if (!moving) {
      const stopTurnBrake = Number.isFinite(Number(row.stopTurnBrakeUntil)) && now < Number(row.stopTurnBrakeUntil || 0);
      if (stopTurnBrake) {
        const brakeTarget = hasRemoteIdleAnchor(row) ? getRemoteIdleAnchor(row, netX, netZ) : stopTurnLockedTarget(row, netX, netZ, now);
        const tx = Number(brakeTarget.x || netX);
        const tz = Number(brakeTarget.z || netZ);
        const dx = tx - g.position.x;
        const dz = tz - g.position.z;
        const dist = Math.hypot(dx, dz);
        const maxStep = Math.max(0.006, REMOTE_VISUAL_STOP_TURN_MAX_SPEED * Math.max(0.001, Math.min(0.04, dt || 0.016)));
        if (dist <= Math.max(maxStep, REMOTE_VISUAL_STOP_TURN_SNAP_DISTANCE)) {
          g.position.x = tx;
          g.position.z = tz;
        } else if (dist > 0.0001) {
          const k = maxStep / dist;
          g.position.x += dx * k;
          g.position.z += dz * k;
        }
        const targetIdleAngle = Number.isFinite(Number(row.idleVisualAngle)) ? Number(row.idleVisualAngle) : netAngle;
        const targetRot = targetIdleAngle + Math.PI;
        const rk = softFactor(REMOTE_VISUAL_STOP_TURN_ROT_RATE, dt);
        let diff = targetRot - g.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) < REMOTE_PLAYER_IDLE_ANGLE_EPS) g.rotation.y = targetRot;
        else g.rotation.y += diff * rk;
        g.userData.crouching = !!row.netCrouching;
        g.userData.remoteMoving = false;
        row.visualVelX = 0;
        row.visualVelZ = 0;
        row.remoteCurveActive = false;
        return;
      }
      const sideLockActive = Number.isFinite(Number(row.stopTurnSideLockUntil)) && now < Number(row.stopTurnSideLockUntil || 0);
      const sideSettleActive = !sideLockActive && Number.isFinite(Number(row.stopTurnSideSettleUntil)) && now < Number(row.stopTurnSideSettleUntil || 0);
      if (sideLockActive || sideSettleActive) {
        const idleTarget = hasRemoteIdleAnchor(row) ? getRemoteIdleAnchor(row, netX, netZ) : stopTurnLockedTarget(row, netX, netZ, now);
        const tx = Number(idleTarget.x || netX);
        const tz = Number(idleTarget.z || netZ);
        const dx = tx - g.position.x;
        const dz = tz - g.position.z;
        const dist = Math.hypot(dx, dz);
        const settleSpeed = sideLockActive ? Math.min(1.35, REMOTE_VISUAL_STOP_TURN_MAX_SPEED) : REMOTE_VISUAL_STOP_TURN_SIDE_SETTLE_SPEED;
        const maxStep = Math.max(0.001, settleSpeed * Math.max(0.001, Math.min(0.04, dt || 0.016)));
        if (dist <= maxStep) {
          g.position.x = tx;
          g.position.z = tz;
        } else if (dist > 0.0001) {
          const stepK = maxStep / dist;
          g.position.x += dx * stepK;
          g.position.z += dz * stepK;
        }
      } else {
        const idleTarget = getRemoteIdleAnchor(row, netX, netZ);
        const tx = Number(idleTarget.x || netX);
        const tz = Number(idleTarget.z || netZ);
        const dx = tx - g.position.x;
        const dz = tz - g.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.0001) {
          // Move idle corrections with a fixed visual speed, not a fractional
          // snap toward every new net packet. This keeps the standing model still.
          const maxStep = Math.max(0.001, REMOTE_VISUAL_IDLE_ANCHOR_SETTLE_SPEED * Math.max(0.001, Math.min(0.04, dt || 0.016)));
          if (dist <= Math.max(maxStep, REMOTE_PLAYER_IDLE_SNAP_DISTANCE)) {
            g.position.x = tx;
            g.position.z = tz;
          } else {
            const stepK = maxStep / dist;
            g.position.x += dx * stepK;
            g.position.z += dz * stepK;
          }
        }
      }
      const targetIdleAngle = Number.isFinite(Number(row.idleVisualAngle)) ? Number(row.idleVisualAngle) : netAngle;
      const targetRot = targetIdleAngle + Math.PI;
      if (Math.abs(targetRot - g.rotation.y) < REMOTE_PLAYER_IDLE_ANGLE_EPS) g.rotation.y = targetRot;
      else g.rotation.y = remoteAngleBlend(g.rotation.y, targetRot, dt, true);
      g.userData.crouching = !!row.netCrouching;
      g.userData.remoteMoving = false;
      row.visualVelX = 0;
      row.visualVelZ = 0;
      return;
    }

    let dirX = Number(row.intentX || 0);
    let dirZ = Number(row.intentZ || 0);
    let dirLen = Math.hypot(dirX, dirZ);
    if (!Number.isFinite(dirLen) || dirLen < 0.01) {
      const dx = netX - x0;
      const dz = netZ - z0;
      dirLen = Math.hypot(dx, dz);
      if (dirLen > 0.01) { dirX = dx / dirLen; dirZ = dz / dirLen; }
      else { dirX = Math.sin(netAngle); dirZ = Math.cos(netAngle); }
    } else {
      dirX /= dirLen;
      dirZ /= dirLen;
    }

    const targetSpeed = Math.min(REMOTE_PLAYER_MAX_VELOCITY, Math.max(0, Number(row.intentSpeed || 0)));
    const curveMode = !!(row.curveModeUntil && now <= Number(row.curveModeUntil)) && !sharpTurn;
    if (curveMode) {
      const handledCurve = updateRemoteVisualCurveMotion(row, dt, now, { netX, netZ, netAngle, dirX, dirZ, targetSpeed });
      if (handledCurve) return;
    } else {
      row.remoteCurveActive = false;
    }
    const currentVelX = Number.isFinite(Number(row.visualVelX)) ? Number(row.visualVelX) : 0;
    const currentVelZ = Number.isFinite(Number(row.visualVelZ)) ? Number(row.visualVelZ) : 0;
    const vk = softFactor(sharpTurn ? 34 : turning ? 25 : 18, dt);
    const desiredVx = dirX * targetSpeed;
    const desiredVz = dirZ * targetSpeed;
    const vx = currentVelX + (desiredVx - currentVelX) * vk;
    const vz = currentVelZ + (desiredVz - currentVelZ) * vk;
    row.visualVelX = vx;
    row.visualVelZ = vz;

    // Move every frame like a local character.
    g.position.x += vx * dt;
    g.position.z += vz * dt;

    // Invisible server anchor with a very small look-ahead. This is not the model
    // position; it is only a guide for slow correction. The correction is split
    // into along-track and side-track parts so the model is not constantly pulled
    // backwards while the remote player runs for a long distance.
    const predictMs = turning ? REMOTE_VISUAL_TURN_PREDICT_MS : REMOTE_VISUAL_PREDICT_MS;
    const predictSec = Math.min(predictMs, packetAgeMs) / 1000;
    const anchorX = netX + desiredVx * predictSec;
    const anchorZ = netZ + desiredVz * predictSec;
    let errX = anchorX - g.position.x;
    let errZ = anchorZ - g.position.z;
    let along = errX * dirX + errZ * dirZ;
    const sideX = errX - along * dirX;
    const sideZ = errZ - along * dirZ;

    // Correct lateral drift. During turns this must be capped as a side speed,
    // not applied as a direct position fraction: otherwise a vector change shifts
    // the whole remote model sideways for one or two frames.
    applyRemoteLateralCorrection(g, sideX, sideZ, dt, { turning });

    // If the visual model is behind the anchor, catch up. If it is only a little
    // ahead, do not pull it backwards: that is the classic remote-player jitter.
    // Only clamp when it gets too far ahead to keep combat/interaction readable.
    if (along > 0.01) {
      const behindK = softFactor(turning ? REMOTE_VISUAL_TURN_BEHIND_CORRECTION : REMOTE_VISUAL_BEHIND_CORRECTION, dt);
      g.position.x += dirX * along * behindK;
      g.position.z += dirZ * along * behindK;
    } else if (!turning && along < -REMOTE_VISUAL_AHEAD_HARD_LIMIT) {
      const maxAheadX = anchorX + dirX * REMOTE_VISUAL_AHEAD_SOFT_LIMIT;
      const maxAheadZ = anchorZ + dirZ * REMOTE_VISUAL_AHEAD_SOFT_LIMIT;
      const clampK = softFactor(9.5, dt);
      g.position.x += (maxAheadX - g.position.x) * clampK;
      g.position.z += (maxAheadZ - g.position.z) * clampK;
    }

    // Large real teleports, respawns or room changes still snap. Normal motion never
    // uses this branch because visual locomotion keeps the model near the anchor.
    const finalGap = Math.hypot(anchorX - g.position.x, anchorZ - g.position.z);
    let didTeleportSnap = false;
    if (finalGap > REMOTE_PLAYER_TELEPORT_SNAP_DISTANCE) {
      g.position.set(netX, 0, netZ);
      row.visualVelX = 0;
      row.visualVelZ = 0;
      didTeleportSnap = true;
    } else if (finalGap > REMOTE_PLAYER_SNAP_DISTANCE) {
      const emergencyK = softFactor(turning ? 5.5 : 8.5, dt);
      g.position.x += (anchorX - g.position.x) * emergencyK;
      g.position.z += (anchorZ - g.position.z) * emergencyK;
    }
    if (!didTeleportSnap) {
      clampRemoteVisualFrameMotion(g, x0, z0, targetSpeed, dt, { turning, extraSpeed: turning ? REMOTE_VISUAL_FRAME_TURN_EXTRA_SPEED : REMOTE_VISUAL_FRAME_EXTRA_SPEED });
    }

    const targetRot = netAngle + Math.PI;
    g.rotation.y = remoteAngleBlend(g.rotation.y, targetRot, dt, !sharpTurn && turning);
    g.userData.crouching = !!row.netCrouching;
    g.userData.remoteMoving = true;
  }

  function updateRemotePlayers(dt) {
    const now = performance.now();
    multiplayer.remotePlayers.forEach(row => {
      const g = row.group;
      if (!g) return;
      updateRemoteVisualLocomotion(row, dt, now);
      row.x = g.position.x;
      row.z = g.position.z;
      applyCharacterCrouchVisual(g, !!g.userData.crouching, dt);
      updateCharacterLocomotionAnimation(g, dt, {
        moving: !!g.userData.remoteMoving,
        speed: Math.hypot(Number(row.visualVelX || 0), Number(row.visualVelZ || 0)),
        crouching: !!g.userData.crouching
      });
      applyCharacterInjuryVisual(g, row.data?.injuries || {}, dt);
      updateWeaponVisualAnimation(g.userData.parts?.weaponGroup, dt, {
        x: row.x,
        z: row.z,
        angle: Number.isFinite(Number(row.netAngle)) ? Number(row.netAngle) : Number(g.userData.targetAngle || 0)
      });
      updateCharacterMeleeAnimation(g, dt);
    });
  }
