// Copyright 2026 LEO ABR project. Distributed under the dash.js BSD-3-Clause license.
import FactoryMaker from '../../../../core/FactoryMaker';
import EventBus from '../../../../core/EventBus';
import MediaPlayerEvents from '../../../MediaPlayerEvents';
import SwitchRequest from '../../SwitchRequest';

function AnjanRule(config) {
    const context = this.context;
    const eventBus = EventBus(context).getInstance();
    let instance, cached = null, epoch = 0, since = 0, sequence = 0;
    const metrics = config.dashMetrics;

    function emit(event) {
        if (window.app && window.app.addEvent) {
            window.app.addEvent(event);
        }
    }

    function onSeek() {
        epoch += 1;
        since = Date.now();
        cached = null;
        emit({type: 'anjanReset', epoch, at_ms: since});
    }

    function onRequest(e) {
        const r = e.request;
        if (!r || r.mediaType !== 'video' || r.type !== 'MediaSegment' || !cached) return;
        const link = {decision_id: cached.id, at_ms: Date.now(), url: r.url,
            quality: r.quality, representation_id: r.representationId,
            media_start_s: r.startTime, index: r.index};
        cached.requests.push(link);
        emit({type: 'anjanRequest', ...link});
    }

    function onRendered(e) {
        if (e.mediaType === 'video') {
            const played = {type: 'anjanRendered', at_ms: Date.now(), quality: e.newQuality};
            window.__anjanRendered = window.__anjanRendered || [];
            window.__anjanRendered.push(played);
            emit(played);
        }
    }

    function getMaxIndex(rulesContext) {
        const answer = SwitchRequest(context).create();
        if (!rulesContext || rulesContext.getMediaType() !== 'video') return answer;
        const started = performance.now();
        const now = Date.now();
        const media = rulesContext.getMediaInfo();
        const ladder = media.bitrateList.map((r, quality) => ({quality,
            bandwidth: r.bandwidth, id: r.id})).sort((a, b) => a.bandwidth - b.bandwidth);
        if (!ladder.length) return answer;
        const completed = metrics.getHttpRequests('video').filter(r =>
            r.type === 'MediaSegment' && r.responsecode >= 200 && r.responsecode < 300 &&
            +r._tfinish >= since && +r._tfinish > +r.trequest && r.trace && r.trace.length);
        const last = completed[completed.length - 1];
        const key = epoch + ':' + (last ? last.url + ':' + (+last._tfinish) : 'startup');
        if (cached && cached.key === key) {
            answer.quality = cached.quality;
            answer.reason = {policy: config.mode, decision_id: cached.id, cached: true};
            window.__anjanCallbackDurations = window.__anjanCallbackDurations || [];
            window.__anjanCallbackDurations.push({cached: true, ms: performance.now() - started});
            return answer;
        }
        const playback = rulesContext.getScheduleController().getPlaybackController();
        const previous = rulesContext.getAbrController().getQualityFor('video', rulesContext.getStreamInfo().id);
        const obs = {buffer_s: metrics.getCurrentBufferLevel('video') || 0,
            target_s: playback.getLiveDelay() || 3,
            live_latency_s: playback.getCurrentLiveLatency() || 0,
            playback_rate: playback.getPlaybackRate() || 1, previous_quality: previous,
            history: completed.slice(-8).map(r => {
                const bytes = r.trace.reduce((n, t) => n + (t.b ? t.b[0] : 0), 0);
                const duration = (+r._tfinish - +r.trequest) / 1000;
                return {mbps: 8 * bytes / duration / 1e6, download_s: duration,
                    age_s: Math.max(0, (now - +r._tfinish) / 1000), bytes,
                    url: r.url, finished_ms: +r._tfinish};
            }), ladder};
        let result, input = null;
        const runtime = window.LEO_ABR;
        try {
            if (!runtime || !runtime.core) throw new Error('preprocessing-unavailable');
            if (config.mode === 'rl') {
                if (!runtime.predict) throw new Error('model-unavailable');
                if (ladder.length !== runtime.actionBitrates.length ||
                    ladder.some((r, i) => r.bandwidth !== runtime.actionBitrates[i])) {
                    throw new Error('model-ladder-mismatch');
                }
                input = Array.from(runtime.core.features(obs));
                result = runtime.predict(input);
                if (!Number.isInteger(result.action) || result.action < 0 || result.action >= ladder.length) {
                    throw new Error('invalid-model-action');
                }
            } else {
                result = runtime.core.simple(obs);
            }
        } catch (e) {
            result = {action: 0, reason: e.message, fallback: true};
        }
        const selected = ladder[result.action];
        const log = {id: epoch + '-' + (++sequence), key, epoch, at_ms: now,
            mode: config.mode, observation: obs, input, action: result.action,
            quality: selected.quality, representation_id: selected.id,
            bitrate_bps: selected.bandwidth, result, requests: [],
            model: runtime && runtime.modelIdentity || null,
            duration_ms: performance.now() - started};
        cached = log;
        window.__anjanDecisionLog = window.__anjanDecisionLog || [];
        window.__anjanDecisionLog.push(log);
        emit({type: 'anjanDecision', ...log});
        answer.quality = selected.quality;
        answer.reason = {policy: config.mode, decision_id: log.id};
        rulesContext.getScheduleController().setTimeToLoadDelay(0);
        log.duration_ms = performance.now() - started;
        window.__anjanCallbackDurations = window.__anjanCallbackDurations || [];
        window.__anjanCallbackDurations.push({cached: false, ms: log.duration_ms});
        return answer;
    }

    function reset() {
        eventBus.off(MediaPlayerEvents.PLAYBACK_SEEKING, onSeek, instance);
        eventBus.off(MediaPlayerEvents.FRAGMENT_LOADING_STARTED, onRequest, instance);
        eventBus.off(MediaPlayerEvents.QUALITY_CHANGE_RENDERED, onRendered, instance);
        cached = null;
    }
    instance = {getMaxIndex, reset};
    eventBus.on(MediaPlayerEvents.PLAYBACK_SEEKING, onSeek, instance);
    eventBus.on(MediaPlayerEvents.FRAGMENT_LOADING_STARTED, onRequest, instance);
    eventBus.on(MediaPlayerEvents.QUALITY_CHANGE_RENDERED, onRendered, instance);
    return instance;
}
AnjanRule.__dashjs_factory_name = 'AnjanRule';
export default FactoryMaker.getClassFactory(AnjanRule);
