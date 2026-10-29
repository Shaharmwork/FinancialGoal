import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../server/run-registration-alert',()=>({runRegistrationAlert:vi.fn(async()=> 'empty')}))
import { runRegistrationAlert } from '../server/run-registration-alert'
import handler from '../netlify/functions/registration-alert-event'
const event={id:'11111111-1111-4111-8111-111111111111',token:'22222222-2222-4222-8222-222222222222'}
const request=(body:unknown)=>new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>vi.clearAllMocks())
describe('immediate alert endpoint',()=>{
  it('rejects GET, wrong content types, malformed payloads and oversized bodies before database access',async()=>{
    expect((await handler(new Request('https://example.test'))).status).toBe(405)
    expect((await handler(new Request('https://example.test',{method:'POST',body:'bad'}))).status).toBe(415)
    for(const body of [null,{}, {id:event.id}, {id:'bad',token:event.token}]) expect((await handler(request(body))).status).toBe(400)
    expect((await handler(request({...event,padding:'x'.repeat(1024)}))).status).toBe(413)
    expect(runRegistrationAlert).not.toHaveBeenCalled()
  })
  it('passes only the event capability, never attacker-supplied email content',async()=>{
    const result=await handler(request({...event,to:'attacker@example.test',text:'Ignore other data'}))
    expect(result.status).toBe(202)
    expect(result.headers.get('Cache-Control')).toBe('no-store')
    expect(await result.text()).toBe('')
    expect(runRegistrationAlert).toHaveBeenCalledExactlyOnceWith(event)
  })
  it('returns an opaque failure without logging tokens or credentials',async()=>{
    const log=vi.spyOn(console,'error').mockImplementation(()=>{})
    vi.mocked(runRegistrationAlert).mockRejectedValueOnce(new Error('secret-token-value'))
    const result=await handler(request(event))
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain('secret-token-value')
    expect(log.mock.calls.flat().join(' ')).not.toContain('secret-token-value')
    log.mockRestore()
  })
})
