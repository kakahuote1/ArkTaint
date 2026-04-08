classdef Missile
   properties
       coord = zeros(1,3);
       v0 = 300; v; coord_now = zeros(1,3);
   end

   methods
       function obj = Missile(coords)
           if nargin > 0
               obj.coord(1) = coords(1);
               obj.coord(2) = coords(2);
               obj.coord(3) = coords(3);
               a = sqrt(coords(1)^2+coords(2)^2+coords(3)^2);
               obj.v(1) = -obj.v0*coords(1)/a;
               obj.v(2) = -obj.v0*coords(2)/a;
               obj.v(3) = -obj.v0*coords(3)/a;
               obj.coord_now = obj.coord;
           end
       end

       function [obj,pres_coord] = update_coord(obj,t)
           pres_coord(1) = obj.coord(1)+obj.v(1)*t;
           pres_coord(2) = obj.coord(2)+obj.v(2)*t;
           pres_coord(3) = obj.coord(3)+obj.v(3)*t;
           obj.coord_now = pres_coord;
       end

       function pres_coord = cal_coord(obj,t)
           pres_coord(1) = obj.coord(1)+obj.v(1)*t;
           pres_coord(2) = obj.coord(2)+obj.v(2)*t;
           pres_coord(3) = obj.coord(3)+obj.v(3)*t;
       end
   end
end