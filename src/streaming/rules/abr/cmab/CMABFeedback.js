/* Request-outcome bookkeeping. Outcomes are download surrogates, never played QoE. */
export default function CMABFeedback(now = () => Date.now(), log = () => {}) {
    const records = new WeakMap();
    const active = new Set();
    const rows = [];
    let candidate = null, epoch = 0, serial = 0;
    function offer(decision) { candidate = {...decision, at_ms: now(), epoch}; }
    function start(request) {
        if (!request || request.mediaType !== 'video' || request.type !== 'MediaSegment' || records.has(request)) return;
        const match = candidate && candidate.action === request.quality && candidate.epoch === epoch && now()-candidate.at_ms < 1000;
        const record = {request_id: 'cmab-request-'+serial++, epoch, start_ms: now(),
            quality: request.quality, media_start_s: request.startTime,
            url: request.url, decision: match ? candidate : null, settled: false};
        if (match) candidate = null; // one choice may train at most one concrete request
        records.set(request, record); active.add(record);
        log({type: 'request-start', ...record, decision: undefined, decision_id: record.decision ? record.decision.id : null});
    }
    function finish(request, outcome, latency) {
        const r = records.get(request);
        if (!r || r.settled) return;
        r.settled = true; active.delete(r);
        const elapsed_s = Math.max(0, (now()-r.start_ms)/1000);
        const accepted = outcome === 'complete' && r.epoch === epoch && !!r.decision;
        let reward = null;
        if (accepted) {
            reward = r.decision.reward(elapsed_s, latency);
            if (Number.isFinite(reward)) {
                rows.push({observation: r.decision.observation, action: r.decision.action,
                    bitrate: r.decision.bitrate, reward, request_id: r.request_id, decision_id: r.decision.id});
                if (rows.length > 30) rows.shift();
            }
        }
        log({type: 'request-outcome', request_id:r.request_id, decision_id:r.decision ? r.decision.id : null,
            epoch:r.epoch, outcome, elapsed_s, accepted, reward});
    }
    function seek() {
        epoch++; candidate = null;
        active.forEach(r => {r.settled = true; log({type:'request-outcome',request_id:r.request_id,
            decision_id:r.decision ? r.decision.id : null,outcome:'seek-censored',accepted:false,reward:null});});
        active.clear();
    }
    return {offer, start, finish, seek, rows};
}
