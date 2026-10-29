const isSpace=event=>event.code==='Space'||event.key===' '||event.key==='Spacebar';
const editable='input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"]';

// Space belongs to the game while its main screen is active. Keep focus intact:
// Enter still activates focused tools. Modal Space must not activate their close
// button and turn the rest of a rapid key sequence into unintended spins.
export function installSpinShortcut({target,controls,isBlocked=()=>false,isModalOpen=()=>false}){
  let handledPress=false;
  const capture={capture:true};
  const keydown=event=>{
    if(!isSpace(event)||event.defaultPrevented||event.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||isBlocked()||event.target?.closest?.(editable))return;
    if(isModalOpen()){
      // Record disclosure rows and rules tabs retain their native keyboard use.
      if(!event.target?.closest?.('summary,[role="tab"]')){
        event.preventDefault();
        handledPress=true;
      }
      return;
    }
    event.preventDefault();
    handledPress=true;
    if(!event.repeat)controls.space();
  };
  const keyup=event=>{
    if(!handledPress||!isSpace(event))return;
    handledPress=false;
    // Also cancel button activation on release, even if focus or a dialog changed
    // while the request was in flight. This key press has already been consumed.
    event.preventDefault();
  };
  const reset=()=>{handledPress=false;};
  target.addEventListener('keydown',keydown,capture);
  target.addEventListener('keyup',keyup,capture);
  target.defaultView?.addEventListener('blur',reset);
  return ()=>{
    target.removeEventListener('keydown',keydown,capture);
    target.removeEventListener('keyup',keyup,capture);
    target.defaultView?.removeEventListener('blur',reset);
    reset();
  };
}
