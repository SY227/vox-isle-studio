class PcmCapture extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Float32Array(2048);this.offset=0;this.alive=true;this.port.onmessage=e=>{if(e.data==='stop'){if(this.offset)this.port.postMessage(this.buffer.slice(0,this.offset));this.alive=false;}};}
  process(inputs){
    const channel=inputs[0]?.[0];
    if(channel && this.alive)for(let i=0;i<channel.length;i++){this.buffer[this.offset++]=channel[i];if(this.offset===this.buffer.length){this.port.postMessage(this.buffer);this.buffer=new Float32Array(2048);this.offset=0;}}
    return this.alive;
  }
}
registerProcessor('pcm-capture',PcmCapture);
