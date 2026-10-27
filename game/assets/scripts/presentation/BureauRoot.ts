import { _decorator, Component, Node, UITransform, Graphics, Label, Color, Vec3, EventTouch, game, Game, view, ResolutionPolicy, Layers, Canvas, profiler, input, Input, EventKeyboard, KeyCode, sys } from 'cc';
import { GROWTH_DEVELOPMENT_CONTENT } from '../content/catalog';
import { GamePresenter, Painter } from './GamePresenter';
import { LocalStorageAdapter } from '../adapters/local-storage';
import { SessionStore } from '../application/session-store';
const { ccclass } = _decorator;
/** Code-drawn original visuals; no bundled third-party art or fonts. */
class CocosPainter implements Painter {
  private readonly graphics:Graphics;
  private readonly labels:Label[]=[];
  private textIndex=0;
  private colors=new Map<string,Color>();
  constructor(private readonly root:Node){this.graphics=root.addComponent(Graphics);}
  private color(hex:string):Color {let color=this.colors.get(hex);if(!color){color=Color.fromHEX(new Color(),hex);this.colors.set(hex,color);}return color;}
  begin():void{this.graphics.clear();this.textIndex=0;}
  end():void{for(let i=this.textIndex;i<this.labels.length;i++)this.labels[i].node.active=false;}
  rect(x:number,y:number,w:number,h:number,fill:string,stroke?:string,radius=0):void {
    if(w<=0||h<=0)return;const g=this.graphics;g.fillColor=this.color(fill);g.lineWidth=1;
    if(radius>0)g.roundRect(x-360,640-y-h,w,h,Math.min(radius,w/2,h/2));else g.rect(x-360,640-y-h,w,h);
    g.fill();if(stroke){g.strokeColor=this.color(stroke);g.stroke();}
  }
  line(x:number,y:number,x2:number,y2:number,color:string,width=1):void {
    const g=this.graphics;g.lineWidth=width;g.strokeColor=this.color(color);g.moveTo(x-360,640-y);g.lineTo(x2-360,640-y2);g.stroke();
  }
  circle(x:number,y:number,r:number,fill:string,stroke?:string):void {
    const g=this.graphics;g.fillColor=this.color(fill);g.circle(x-360,640-y,r);g.fill();if(stroke){g.lineWidth=1;g.strokeColor=this.color(stroke);g.stroke();}
  }
  polygon(points:number[][],fill:string,stroke?:string):void {
    if(!points.length)return;const g=this.graphics;g.fillColor=this.color(fill);g.moveTo(points[0][0]-360,640-points[0][1]);for(const [x,y] of points.slice(1))g.lineTo(x-360,640-y);g.close();g.fill();if(stroke){g.strokeColor=this.color(stroke);g.lineWidth=1;g.stroke();}
  }
  text(value:string,x:number,y:number,size:number,color:string,align:'left'|'center'|'right'='left',bold=false,maxWidth=700):void {
    const index=this.textIndex++;let label=this.labels[index];
    if(!label){const node=new Node('Text-'+index);node.layer=Layers.Enum.UI_2D;this.root.addChild(node);label=node.addComponent(Label);label.fontFamily='sans-serif';label.useSystemFont=true;label.enableWrapText=false;label.overflow=Label.Overflow.SHRINK;label.verticalAlign=Label.VerticalAlign.CENTER;this.labels.push(label);}
    label.node.active=true;label.string=value;label.fontSize=size;label.lineHeight=size*1.35;label.color=this.color(color);label.isBold=bold;
    label.horizontalAlign=align==='left'?Label.HorizontalAlign.LEFT:align==='right'?Label.HorizontalAlign.RIGHT:Label.HorizontalAlign.CENTER;
    const ui=label.getComponent(UITransform)!;ui.setAnchorPoint(align==='left'?0:align==='right'?1:0.5,0.5);ui.setContentSize(maxWidth,size*1.7);label.node.setPosition(x-360,640-y,0);
  }
}
@ccclass('BureauRoot')
export class BureauRoot extends Component {
  private presenter!:GamePresenter;
  private painter!:CocosPainter;
  private surface!:Node;
  private readonly point=new Vec3();
  onLoad():void {
    profiler.hideStats();
    view.setDesignResolutionSize(720,1280,ResolutionPolicy.SHOW_ALL);
    const canvas=this.node.getComponent(Canvas);if(canvas)canvas.alignCanvasWithScreen=true;
    this.surface=new Node('BureauSurface');this.surface.layer=Layers.Enum.UI_2D;this.node.addChild(this.surface);this.surface.addComponent(UITransform).setContentSize(720,1280);
    const installId='local-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,14);
    const store=new SessionStore(new LocalStorageAdapter(sys.localStorage),GROWTH_DEVELOPMENT_CONTENT,installId);
    this.presenter=new GamePresenter(GROWTH_DEVELOPMENT_CONTENT,store);this.painter=new CocosPainter(this.surface);
    this.surface.on(Node.EventType.TOUCH_START,this.onTouchStart,this);this.surface.on(Node.EventType.TOUCH_MOVE,this.onTouchMove,this);this.surface.on(Node.EventType.TOUCH_END,this.onTouchEnd,this);this.surface.on(Node.EventType.TOUCH_CANCEL,this.onTouchCancel,this);
    game.on(Game.EVENT_HIDE,this.onHide,this);game.on(Game.EVENT_SHOW,this.onShow,this);input.on(Input.EventType.KEY_DOWN,this.onKeyDown,this);
    this.presenter.draw(this.painter);
    console.info('[Bureau] local-save development scene ready; no ads or cloud sync; '+GROWTH_DEVELOPMENT_CONTENT.version);
  }
  private coordinates(event:EventTouch):Vec3 {
    const p=event.getUILocation();this.point.set(p.x,p.y,0);this.surface.getComponent(UITransform)!.convertToNodeSpaceAR(this.point,this.point);this.point.set(this.point.x+360,640-this.point.y,0);return this.point;
  }
  private onTouchStart(event:EventTouch):void{const p=this.coordinates(event);this.presenter.pointerDown(p.x,p.y);}
  private onTouchMove(event:EventTouch):void{const p=this.coordinates(event);this.presenter.pointerMove(p.x,p.y);}
  private onTouchEnd(event:EventTouch):void{const p=this.coordinates(event);this.presenter.pointerUp(p.x,p.y);}
  private onKeyDown(event:EventKeyboard):void{if(event.keyCode===KeyCode.KEY_R)this.presenter.key('r');if(event.keyCode===KeyCode.KEY_Z)this.presenter.key('z');if(event.keyCode===KeyCode.ESCAPE)this.presenter.key('Escape');}
  private onTouchCancel():void{this.presenter.cancelPointer();}
  private onHide():void{this.presenter.background(true);}
  private onShow():void{this.presenter.background(false);}
  update(dt:number):void{this.presenter.update(dt);this.presenter.draw(this.painter);}
  onDestroy():void{this.presenter?.checkpoint();input.off(Input.EventType.KEY_DOWN,this.onKeyDown,this);game.off(Game.EVENT_HIDE,this.onHide,this);game.off(Game.EVENT_SHOW,this.onShow,this);this.surface?.off(Node.EventType.TOUCH_START,this.onTouchStart,this);this.surface?.off(Node.EventType.TOUCH_MOVE,this.onTouchMove,this);this.surface?.off(Node.EventType.TOUCH_END,this.onTouchEnd,this);this.surface?.off(Node.EventType.TOUCH_CANCEL,this.onTouchCancel,this);}
}
