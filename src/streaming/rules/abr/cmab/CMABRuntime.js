/* Shared dependency prewarm; decisions still execute synchronously in Pyodide. */
const {loadPyodide} = require('pyodide');
let ready = null;
export default function prepareCMABRuntime() {
    if (!ready) ready = (async () => {
        const runtime = await loadPyodide({indexURL:'http://pyodide/pyodide/'});
        await runtime.loadPackage(['pandas','matplotlib','numpy','Pillow','scikit-learn','scipy',
            'http://pyodide/pyodide/mabwiser-2.7.0-py3-none-any.whl',
            'http://pyodide/pyodide/itu_p1203-1.9.5-py3-none-any.whl']);
        runtime.runPython('from mabwiser.mab import MAB');
        return runtime;
    })().catch(error => {ready=null;throw error;});
    return ready;
}
if (typeof window !== 'undefined') window.LEO_PREWARM_CMAB = prepareCMABRuntime;
