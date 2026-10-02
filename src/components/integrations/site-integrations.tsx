'use client'

/**
 * GKSetu — Site integrations injector (CONSOLE-S1).
 *
 * The one component that turns the Console → Settings → Integrations values
 * into live third-party code: Google Analytics (gtag.js), Google Tag
 * Manager, the Meta/Facebook pixel and the team's custom head/body HTML.
 * Fetches the whitelisted public payload (GET /api/settings/public) once per
 * page load and injects — no redeploy, no code edits (the user's request).
 *
 * Notes:
 * - The GSC/Bing verification metas are injected SERVER-side in
 *   `src/app/layout.tsx` (generateMetadata) — crawlers need them in the
 *   served HTML; everything a browser runs client-side is safe here.
 * - Raw HTML is materialised node-by-node so <script> tags actually execute
 *   (innerHTML scripts never run — a classic footgun this avoids).
 * - Guards + idempotency keys keep hot-reload/dev from double-injecting.
 */
import { useEffect } from 'react'

interface PublicSettingsPayload {
  settings: Record<string, string>
  countryIso: string | null
}

const INJECTED_FLAG = 'data-gksetu-integration'

function injectRawHtml(containerId: string, html: string): void {
  const host = document.getElementById(containerId)
  if (!host) return
  // Fresh materialisation each call — React never manages these nodes.
  host.replaceChildren()
  const template = document.createElement('template')
  template.innerHTML = html
  for (const node of [...template.content.childNodes]) {
    if (node instanceof HTMLScriptElement) {
      const script = document.createElement('script')
      for (const attr of [...node.attributes]) script.setAttribute(attr.name, attr.value)
      script.text = node.text
      script.setAttribute(INJECTED_FLAG, '')
      host.appendChild(script) // appending a created script EXECUTES it
    } else {
      host.appendChild(node.cloneNode(true))
    }
  }
}

function injectGtag(measurementId: string): void {
  if (document.querySelector(`script[${INJECTED_FLAG}="ga"]`)) return
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`
  script.setAttribute(INJECTED_FLAG, 'ga')
  document.head.appendChild(script)

  const inline = document.createElement('script')
  inline.setAttribute(INJECTED_FLAG, 'ga-inline')
  inline.text = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${measurementId}',{send_page_view:true});`
  document.head.appendChild(inline)
}

function injectGtm(containerId: string): void {
  if (document.querySelector(`script[${INJECTED_FLAG}="gtm"]`)) return
  const inline = document.createElement('script')
  inline.setAttribute(INJECTED_FLAG, 'gtm')
  inline.text = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${containerId}');`
  document.head.appendChild(inline)
}

function injectFacebookPixel(pixelId: string): void {
  if (document.querySelector(`script[${INJECTED_FLAG}="fbpx"]`)) return
  const inline = document.createElement('script')
  inline.setAttribute(INJECTED_FLAG, 'fbpx')
  inline.text = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');`
  document.head.appendChild(inline)
}

export function SiteIntegrations() {
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const response = await fetch('/api/settings/public', { cache: 'no-store' })
        if (!response.ok) return
        const payload = (await response.json()) as
          | { status: 'ok'; data: PublicSettingsPayload }
          | { status: 'error' }
        if (payload.status !== 'ok' || cancelled) return
        const s = payload.data.settings

        const ga = s['integration.ga.measurementId']?.trim()
        if (ga && /^G-[A-Z0-9]+$/.test(ga)) injectGtag(ga)

        const gtm = s['integration.gtm.containerId']?.trim()
        if (gtm && /^GTM-[A-Z0-9]+$/.test(gtm)) injectGtm(gtm)

        const fbpx = s['integration.facebook.pixelId']?.trim()
        if (fbpx && /^\d{8,}$/.test(fbpx)) injectFacebookPixel(fbpx)

        const headCode = s['integration.headCode']?.trim()
        if (headCode) injectRawHtml('gksetu-custom-head', headCode)

        const bodyCode = s['integration.bodyStartCode']?.trim()
        if (bodyCode) injectRawHtml('gksetu-custom-body', bodyCode)
      } catch {
        // Integrations are best-effort — never break the app for analytics.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      {/* Neutral DOM anchors the injector materialises raw HTML into. */}
      <div id="gksetu-custom-head" style={{ display: 'none' }} aria-hidden="true" />
      <div id="gksetu-custom-body" style={{ display: 'none' }} aria-hidden="true" />
    </>
  )
}
