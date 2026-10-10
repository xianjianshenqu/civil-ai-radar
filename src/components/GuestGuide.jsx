import { IconMail, IconCloudUpload, IconLanguage } from '@tabler/icons-react';

// 游客注册引导：共享文案与卡片。所有组件只在未登录时由调用方渲染，登录后一律消失。
export function RegisterBenefits() {
  return <div className="register-benefits">
    <strong>登录后可以：</strong>
    <ul>
      <li><IconMail size={15}/><span><b>订阅邮件推送</b>——按领域与关键词，新增／更新线索发送到你的邮箱</span></li>
      <li><IconCloudUpload size={15}/><span><b>同步收藏与笔记</b>——资料保存在账号，换设备、换浏览器不丢</span></li>
      <li><IconLanguage size={15}/><span><b>接入自己的翻译模型</b>——文章翻译调用你自己的 API Key，不占站点额度</span></li>
    </ul>
  </div>;
}

export function SubscribeNudge({onLogin}) {
  return <div className="subscribe-nudge">
    <IconMail size={17}/>
    <p>登录后可订阅邮件推送：按领域与关键词，新增／更新线索发送到邮箱。</p>
    <button type="button" onClick={onLogin}>去登录</button>
  </div>;
}
