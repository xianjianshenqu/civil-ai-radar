import {useCallback, useEffect, useState} from 'react';
import {api} from './api.js';
import {orgWatchlist} from '../data/orgWatchlist.js';

// 合并观察名单：静态名单打底，管理员登录后从后台取界面新增的附加单位。
// 附加单位与静态单位一样只用于关键词计分与选择器，不代表该单位参与。
export function useWatchOrgs(cloud) {
  const [orgs, setOrgs] = useState(orgWatchlist);
  const [loaded, setLoaded] = useState(false);
  const admin = Boolean(cloud?.user?.isAdmin);
  const reload = useCallback(async () => {
    if (!admin) return;
    try {
      const data = await api('/watchlist');
      setOrgs(data.orgs);
      setLoaded(true);
    } catch {
      setLoaded(false);
    }
  }, [admin]);
  useEffect(() => {reload();}, [reload]);
  const add = async input => {
    const data = await api('/watchlist', {method: 'POST', data: input});
    setOrgs(data.orgs);
    return data.orgs;
  };
  const remove = async id => {
    const data = await api('/watchlist', {method: 'DELETE', data: {id}});
    setOrgs(data.orgs);
    return data.orgs;
  };
  return {orgs, loaded, reload, add, remove};
}
