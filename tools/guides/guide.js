/* CGHL member guides — poster helper (2026-09-16).
   A frame's numbered pucks are authored as percentages of the SCREENSHOT (that is what
   tools/demo/shoot.mjs reports in _report.json), but they are positioned inside .frame, which also
   holds the caption below the image — so on a short screenshot a puck at "top:93%" slid down onto
   the caption. Re-anchor every puck to the image box once the images have loaded. */
window.addEventListener("load", function(){
  document.querySelectorAll(".frame").forEach(function(f){
    var img = f.querySelector("img"); if (!img) return;
    f.querySelectorAll(".mark").forEach(function(m){
      var l = parseFloat(m.style.left), t = parseFloat(m.style.top);
      if (!isNaN(t)) m.style.top = (img.offsetTop + t / 100 * img.clientHeight) + "px";
      if (!isNaN(l)) m.style.left = (img.offsetLeft + l / 100 * img.clientWidth) + "px";
    });
  });
});
