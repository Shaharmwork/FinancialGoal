import { runRegistrationAlert } from '../../server/run-registration-alert'

// Recovery only: confirmations normally invoke registration-alert-event immediately.
export default async () => { await runRegistrationAlert() }
