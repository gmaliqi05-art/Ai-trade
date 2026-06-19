// Type shim: metaapi.cloud-sdk nuk deklaron 'types' në package.json (vetëm dist/index.d.ts
// jashtë exports map). E trajtojmë importin si 'any' për të shmangur problemet e rezolvimit të
// tipave nën moduleResolution 'bundler'; runtime-i përdor build-in esm-web të SDK-së.
declare module 'metaapi.cloud-sdk' {
  const MetaApi: any;
  export default MetaApi;
}
declare module 'metaapi.cloud-sdk/web' {
  const MetaApi: any;
  export default MetaApi;
}
