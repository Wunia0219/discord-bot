// Pointer and keyboard activation share the same one-round controller.
export function bindSpinButton(button,controls){
  button.addEventListener('click',()=>controls.space());
  return ({busy,presenting,claiming,ready})=>{
    button.disabled=presenting||claiming||!ready;
    button.setAttribute('aria-label',busy?(presenting?'中獎演出中':'快速停輪'):'旋轉一次');
    button.title=busy?(presenting?'中獎演出中':'再次點擊可快速停輪（空白鍵）'):'旋轉一次（空白鍵）';
    button.setAttribute('aria-busy',String(busy));
    button.classList.toggle('spinning',busy&&!presenting);
  };
}
