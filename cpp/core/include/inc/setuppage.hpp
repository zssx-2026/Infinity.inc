// setuppage.hpp - the first-run screen, in one place.
//
// Both applications that need a GitHub token open on the same question, so the
// page is written once here instead of twice in two main.cpp files that would
// then drift. The page is deliberately one field and one button: it exists to
// get a credential, not to explain the product.

#pragma once

#include <string>

namespace inc {

inline std::string htmlEscapeText(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (char c : s) {
    if (c == '&') out += "&amp;";
    else if (c == '<') out += "&lt;";
    else if (c == '>') out += "&gt;";
    else if (c == '"') out += "&quot;";
    else out += c;
  }
  return out;
}

inline std::string setupPageHtml(const std::string& app, const std::string& why) {
  std::string html = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">";
  html += "<title>" + app + "</title><style>";
  html += "html,body{margin:0;height:100%}";
  html += "body{background:#0e1116;color:#e6edf3;display:flex;align-items:center;justify-content:center;";
  html += "font-family:'Microsoft YaHei',system-ui,-apple-system,sans-serif}";
  html += ".box{width:420px;padding:36px 40px}";
  html += "h1{font-size:20px;font-weight:600;margin:0 0 10px}";
  html += "p{font-size:13px;line-height:1.7;color:#9da7b3;margin:0 0 14px}";
  html += "input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #30363d;border-radius:6px;";
  html += "background:#0b0f14;color:#e6edf3;font-size:14px;font-family:Consolas,monospace}";
  html += "input:focus{outline:none;border-color:#2f81f7}";
  html += "button{width:100%;margin-top:14px;padding:10px 0;border:1px solid #238636;border-radius:6px;";
  html += "background:#238636;color:#fff;font-size:14px;cursor:pointer}";
  html += "button:disabled{opacity:.6;cursor:default}";
  html += ".msg{min-height:20px;margin:12px 0 0;color:#f85149;font-size:13px}";
  html += ".hint{color:#6b7684;font-size:12px;margin-top:18px}";
  html += "</style></head><body><div class='box'><h1>" + app + "</h1>";
  html += "<p>粘贴一个 GitHub 个人访问令牌（需要 repo 权限）。本机会加密保存，下次启动不再询问。</p>";
  html += "<input id='t' type='password' spellcheck='false' autocomplete='off' placeholder='ghp_...' autofocus>";
  html += "<button id='go'>继续</button><p class='msg' id='m'>";
  html += htmlEscapeText(why) + "</p>";
  html += "<p class='hint'>令牌只用于访问你自己的仓库，只保存在本机。</p>";
  html += "<script>";
  html += "var t=document.getElementById('t'),m=document.getElementById('m'),go=document.getElementById('go');";
  html += "function send(){var v=t.value.trim();if(!v){m.textContent='请填写令牌';return;}";
  html += "go.disabled=true;m.style.color='#9da7b3';m.textContent='正在验证…';";
  html += "fetch('/api/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:v})})";
  html += ".then(function(r){return r.text().then(function(x){return [r.ok,x];});})";
  html += ".then(function(p){if(p[0]){location.reload();return;}";
  html += "var why='';try{why=JSON.parse(p[1]).error||'';}catch(e){}";
  html += "m.style.color='#f85149';m.textContent=why||('验证失败（HTTP '+p[0]+'）');go.disabled=false;})";
  html += ".catch(function(e){m.style.color='#f85149';m.textContent='无法连接界面服务';go.disabled=false;});}";
  html += "go.onclick=send;t.addEventListener('keydown',function(e){if(e.key==='Enter')send();});";
  html += "</script></div></body></html>";
  return html;
}

}  // namespace inc
