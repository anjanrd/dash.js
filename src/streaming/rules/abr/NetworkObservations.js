/* Shared causal RTT health for production policies and the passive observer. */
let users=0, timer=null, pending=false;
export default function acquireNetworkObservations() {
    async function poll() {
        if (pending) return;
        pending=true;const controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),1000);
        try {
            const response=await fetch('http://stat-server:8000/ping/details',{signal:controller.signal});
            if (!response.ok) throw new Error('probe-health-http');
            const row=await response.json();window.LEO_PROBE=row;
            const history=window.LEO_PROBE_HISTORY || [];
            if (!history.length || history[history.length-1].probe_at_s!==row.probe_at_s) history.push(row);
            window.LEO_PROBE_HISTORY=history.slice(-8);
        } catch(error) {window.LEO_PROBE={valid:false,ok:false,age_s:null,error:'health-unavailable'};}
        finally {clearTimeout(timeout);pending=false;}
    }
    users++;
    if (!timer) {window.LEO_SHARED_PROBE_ACTIVE=true;poll();timer=setInterval(poll,500);}
    let released=false;
    return () => {if (released) return;released=true;users--;
        if (!users) {clearInterval(timer);timer=null;window.LEO_SHARED_PROBE_ACTIVE=false;}};
}
